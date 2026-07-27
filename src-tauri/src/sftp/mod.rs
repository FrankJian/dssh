use std::{collections::HashMap, sync::Arc, time::Duration};

use russh::{ChannelMsg, client};
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    ssh::HostKeyVerifier,
    ssh::session_manager::{SshClient, authenticate, ssh_error},
};

pub const SFTP_DOWNLOAD_PROGRESS_EVENT: &str = "sftp://download-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    profile_id: String,
    path: String,
    transferred: u64,
    total: Option<u64>,
    done: bool,
}

/// Emit progress at most every ~256 KiB (and always on completion) to avoid
/// flooding the event channel on fast transfers.
const PROGRESS_STEP: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListing {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

struct SftpConn {
    // Keeping the client handle alive keeps the underlying SSH connection (and
    // therefore the SFTP channel stream) open.
    _handle: client::Handle<SshClient>,
    sftp: SftpSession,
}

#[derive(Clone)]
pub struct SftpManager {
    conns: Arc<Mutex<HashMap<String, Arc<SftpConn>>>>,
    host_keys: Arc<HostKeyVerifier>,
}

impl SftpManager {
    pub fn new(host_keys: Arc<HostKeyVerifier>) -> Self {
        Self {
            conns: Arc::new(Mutex::new(HashMap::new())),
            host_keys,
        }
    }

    async fn connection(&self, profile: &SshProfile) -> AppResult<Arc<SftpConn>> {
        if let Some(conn) = self.conns.lock().await.get(&profile.id) {
            return Ok(conn.clone());
        }

        let conn = Arc::new(open_connection(profile, self.host_keys.clone()).await?);
        self.conns
            .lock()
            .await
            .insert(profile.id.clone(), conn.clone());
        Ok(conn)
    }

    async fn drop_connection(&self, profile_id: &str) {
        self.conns.lock().await.remove(profile_id);
    }

    pub async fn home(&self, profile: &SshProfile) -> AppResult<String> {
        let conn = self.connection(profile).await?;
        match conn.sftp.canonicalize(".").await {
            Ok(path) => Ok(normalize_dir(&path)),
            Err(error) => {
                self.drop_connection(&profile.id).await;
                Err(sftp_error(error))
            }
        }
    }

    pub async fn list(&self, profile: &SshProfile, path: &str) -> AppResult<SftpListing> {
        let conn = self.connection(profile).await?;
        let target = if path.trim().is_empty() { "." } else { path };

        let read_dir = match conn.sftp.read_dir(target).await {
            Ok(read_dir) => read_dir,
            Err(error) => {
                self.drop_connection(&profile.id).await;
                return Err(sftp_error(error));
            }
        };

        let canonical = conn
            .sftp
            .canonicalize(target)
            .await
            .map(|value| normalize_dir(&value))
            .unwrap_or_else(|_| normalize_dir(target));

        let mut entries: Vec<SftpEntry> = Vec::new();
        for entry in read_dir {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let metadata = entry.metadata();
            entries.push(SftpEntry {
                path: join_path(&canonical, &name),
                is_dir: metadata.is_dir(),
                is_symlink: metadata.file_type().is_symlink(),
                size: metadata.size.unwrap_or(0),
                modified: metadata.mtime.map(|value| value as i64),
                name,
            });
        }

        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(SftpListing {
            path: canonical,
            entries,
        })
    }

    pub async fn download(
        &self,
        app: &AppHandle,
        profile: &SshProfile,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<()> {
        let conn = self.connection(profile).await?;
        let total = conn
            .sftp
            .metadata(remote_path)
            .await
            .ok()
            .and_then(|meta| meta.size);

        let result = async {
            let mut remote = conn.sftp.open(remote_path).await.map_err(sftp_error)?;
            let write_error =
                |error: std::io::Error| AppError::new("sftp_download_error", error.to_string());
            let mut file = File::create(local_path).await.map_err(write_error)?;

            let mut buffer = vec![0u8; 64 * 1024];
            let mut transferred: u64 = 0;
            let mut last_emitted: u64 = 0;
            emit_progress(app, &profile.id, remote_path, 0, total, false);
            loop {
                let read = remote.read(&mut buffer).await.map_err(write_error)?;
                if read == 0 {
                    break;
                }
                file.write_all(&buffer[..read]).await.map_err(write_error)?;
                transferred += read as u64;
                if transferred - last_emitted >= PROGRESS_STEP {
                    last_emitted = transferred;
                    emit_progress(app, &profile.id, remote_path, transferred, total, false);
                }
            }
            file.flush().await.map_err(write_error)?;
            emit_progress(app, &profile.id, remote_path, transferred, total, true);
            Ok(())
        }
        .await;

        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    /// Download a directory by asking the remote host to stream a gzip'd tarball
    /// of it over an exec channel, writing the archive straight to `local_path`.
    pub async fn download_dir(
        &self,
        app: &AppHandle,
        profile: &SshProfile,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<()> {
        let (parent, base) = split_parent(remote_path)?;
        let conn = self.connection(profile).await?;
        let command = format!(
            "tar -czf - -C {} -- {}",
            shell_quote(&parent),
            shell_quote(&base),
        );

        let result = stream_exec_to_file(
            app,
            &profile.id,
            remote_path,
            &conn._handle,
            &command,
            local_path,
        )
        .await;
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn upload(
        &self,
        profile: &SshProfile,
        local_path: &str,
        remote_path: &str,
    ) -> AppResult<()> {
        let data = tokio::fs::read(local_path)
            .await
            .map_err(|error| AppError::new("sftp_upload_error", error.to_string()))?;

        let conn = self.connection(profile).await?;
        let result = async {
            let mut file = conn
                .sftp
                .open_with_flags(
                    remote_path,
                    OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
                )
                .await
                .map_err(sftp_error)?;
            file.write_all(&data).await.map_err(sftp_error)?;
            file.shutdown().await.map_err(sftp_error)?;
            Ok(())
        }
        .await;

        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn disconnect(&self, profile_id: &str) {
        self.drop_connection(profile_id).await;
    }
}

async fn open_connection(
    profile: &SshProfile,
    verifier: Arc<HostKeyVerifier>,
) -> AppResult<SftpConn> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(24 * 60 * 60)),
        ..<_>::default()
    });
    let client = SshClient::new(verifier, profile.host.clone(), profile.port);
    let mut handle = client::connect(config, (profile.host.as_str(), profile.port), client)
        .await
        .map_err(ssh_error)?;
    authenticate(&mut handle, profile).await?;

    let channel = handle.channel_open_session().await.map_err(ssh_error)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(ssh_error)?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(sftp_error)?;

    Ok(SftpConn {
        _handle: handle,
        sftp,
    })
}

/// Run a command over an exec channel and stream its stdout into a local file.
async fn stream_exec_to_file(
    app: &AppHandle,
    profile_id: &str,
    remote_path: &str,
    handle: &client::Handle<SshClient>,
    command: &str,
    local_path: &str,
) -> AppResult<()> {
    let mut channel = handle.channel_open_session().await.map_err(ssh_error)?;
    channel.exec(true, command).await.map_err(ssh_error)?;

    let write_error =
        |error: std::io::Error| AppError::new("sftp_download_error", error.to_string());
    let mut file = File::create(local_path).await.map_err(write_error)?;
    let mut exit_status: Option<u32> = None;
    let mut stderr: Vec<u8> = Vec::new();
    let mut transferred: u64 = 0;
    let mut last_emitted: u64 = 0;
    // The compressed size is unknown up front, so total stays None (indeterminate).
    emit_progress(app, profile_id, remote_path, 0, None, false);

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => {
                file.write_all(&data[..]).await.map_err(write_error)?;
                transferred += data.len() as u64;
                if transferred - last_emitted >= PROGRESS_STEP {
                    last_emitted = transferred;
                    emit_progress(app, profile_id, remote_path, transferred, None, false);
                }
            }
            ChannelMsg::ExtendedData { ref data, .. } => {
                stderr.extend_from_slice(&data[..]);
            }
            ChannelMsg::ExitStatus { exit_status: code } => {
                exit_status = Some(code);
            }
            _ => {}
        }
    }

    file.flush().await.map_err(write_error)?;

    if let Some(code) = exit_status
        && code != 0
    {
        let detail = String::from_utf8_lossy(&stderr);
        return Err(AppError::new(
            "sftp_download_error",
            format!("远程打包失败（exit {code}）：{}", detail.trim()),
        ));
    }

    emit_progress(app, profile_id, remote_path, transferred, None, true);
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    profile_id: &str,
    path: &str,
    transferred: u64,
    total: Option<u64>,
    done: bool,
) {
    let _ = app.emit(
        SFTP_DOWNLOAD_PROGRESS_EVENT,
        DownloadProgress {
            profile_id: profile_id.to_string(),
            path: path.to_string(),
            transferred,
            total,
            done,
        },
    );
}

/// Split an absolute path into its parent directory and base name for `tar -C`.
fn split_parent(path: &str) -> AppResult<(String, String)> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::new("sftp_download_error", "无法下载根目录。"));
    }
    match trimmed.rfind('/') {
        Some(0) => Ok(("/".to_string(), trimmed[1..].to_string())),
        Some(index) => Ok((
            trimmed[..index].to_string(),
            trimmed[index + 1..].to_string(),
        )),
        None => Ok((".".to_string(), trimmed.to_string())),
    }
}

/// Wrap a value in single quotes, escaping embedded single quotes, for a POSIX shell.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn sftp_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("sftp_error", error.to_string())
}

/// Join a POSIX directory path with a child name.
fn join_path(dir: &str, name: &str) -> String {
    if dir == "/" {
        format!("/{name}")
    } else {
        format!("{}/{name}", dir.trim_end_matches('/'))
    }
}

/// Trim a trailing slash except for the filesystem root.
fn normalize_dir(path: &str) -> String {
    if path.len() > 1 {
        path.trim_end_matches('/').to_string()
    } else {
        path.to_string()
    }
}
