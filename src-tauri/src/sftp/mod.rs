use std::{collections::HashMap, sync::Arc, time::Duration};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
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
/// Keep the in-app editor deliberately lightweight and avoid sending very
/// large remote files through the Tauri IPC boundary.
const MAX_EDITABLE_TEXT_BYTES: usize = 5 * 1_024 * 1_024;
const MAX_PREVIEW_IMAGE_BYTES: usize = 10 * 1_024 * 1_024;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTextFile {
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpImageFile {
    pub data_url: String,
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

    pub async fn create_dir(
        &self,
        profile: &SshProfile,
        parent_path: &str,
        name: &str,
    ) -> AppResult<String> {
        let target = child_path(parent_path, name)?;
        let conn = self.connection(profile).await?;
        let result = conn.sftp.create_dir(&target).await.map_err(sftp_error);
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result.map(|_| target)
    }

    pub async fn create_file(
        &self,
        profile: &SshProfile,
        parent_path: &str,
        name: &str,
    ) -> AppResult<String> {
        let target = child_path(parent_path, name)?;
        let conn = self.connection(profile).await?;
        let result = async {
            // CREATE + EXCLUDE makes an empty-file creation fail if another
            // remote entry already uses this name; Explorer never overwrites.
            let mut file = conn
                .sftp
                .open_with_flags(
                    &target,
                    OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
                )
                .await
                .map_err(sftp_error)?;
            file.shutdown().await.map_err(sftp_error)?;
            Ok(())
        }
        .await;
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result.map(|_| target)
    }

    pub async fn rename(
        &self,
        profile: &SshProfile,
        remote_path: &str,
        new_name: &str,
    ) -> AppResult<String> {
        let source = non_root_path(remote_path)?;
        let parent = parent_path(source);
        let target = child_path(&parent, new_name)?;
        let conn = self.connection(profile).await?;
        let result = conn.sftp.rename(source, &target).await.map_err(sftp_error);
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result.map(|_| target)
    }

    pub async fn delete_file(&self, profile: &SshProfile, remote_path: &str) -> AppResult<()> {
        let target = non_root_path(remote_path)?;
        let conn = self.connection(profile).await?;
        let result = conn.sftp.remove_file(target).await.map_err(sftp_error);
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn delete_empty_dir(&self, profile: &SshProfile, remote_path: &str) -> AppResult<()> {
        let target = non_root_path(remote_path)?;
        let conn = self.connection(profile).await?;
        let result = conn.sftp.remove_dir(target).await.map_err(sftp_error);
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn read_text(
        &self,
        profile: &SshProfile,
        remote_path: &str,
    ) -> AppResult<SftpTextFile> {
        let conn = self.connection(profile).await?;
        let result = async {
            let mut remote = conn.sftp.open(remote_path).await.map_err(sftp_error)?;
            let mut data = Vec::new();
            let mut buffer = vec![0u8; 64 * 1024];

            loop {
                let read = remote.read(&mut buffer).await.map_err(sftp_text_error)?;
                if read == 0 {
                    break;
                }
                if data.len() + read > MAX_EDITABLE_TEXT_BYTES {
                    return Err(AppError::new(
                        "sftp_text_too_large",
                        "文件超过 5 MiB，无法在内置编辑器中打开。",
                    ));
                }
                data.extend_from_slice(&buffer[..read]);
            }

            if data.contains(&0) {
                return Err(AppError::new(
                    "sftp_text_binary",
                    "该文件包含二进制内容，无法作为文本编辑。",
                ));
            }
            let content = String::from_utf8(data).map_err(|_| {
                AppError::new(
                    "sftp_text_encoding",
                    "该文件不是 UTF-8 文本，无法在内置编辑器中打开。",
                )
            })?;
            Ok(SftpTextFile { content })
        }
        .await;

        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn write_text(
        &self,
        profile: &SshProfile,
        remote_path: &str,
        content: &str,
    ) -> AppResult<()> {
        if content.len() > MAX_EDITABLE_TEXT_BYTES {
            return Err(AppError::new(
                "sftp_text_too_large",
                "文件超过 5 MiB，无法通过内置编辑器保存。",
            ));
        }
        if content.contains('\0') {
            return Err(AppError::new(
                "sftp_text_binary",
                "文本内容不能包含 NUL 字符。",
            ));
        }

        let conn = self.connection(profile).await?;
        let result = async {
            // Do not include CREATE: the editor only modifies an existing file
            // selected from the remote tree, never creates a surprise file.
            let mut file = conn
                .sftp
                .open_with_flags(remote_path, OpenFlags::TRUNCATE | OpenFlags::WRITE)
                .await
                .map_err(sftp_error)?;
            file.write_all(content.as_bytes())
                .await
                .map_err(sftp_text_error)?;
            file.shutdown().await.map_err(sftp_text_error)?;
            Ok(())
        }
        .await;

        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn read_image(
        &self,
        profile: &SshProfile,
        remote_path: &str,
    ) -> AppResult<SftpImageFile> {
        let mime = remote_image_mime(remote_path)?;
        let conn = self.connection(profile).await?;
        let result = async {
            let mut remote = conn.sftp.open(remote_path).await.map_err(sftp_error)?;
            let mut data = Vec::new();
            let mut buffer = vec![0u8; 64 * 1024];

            loop {
                let read = remote.read(&mut buffer).await.map_err(sftp_text_error)?;
                if read == 0 {
                    break;
                }
                if data.len() + read > MAX_PREVIEW_IMAGE_BYTES {
                    return Err(AppError::new(
                        "sftp_image_too_large",
                        "图片超过 10 MiB，无法在内置预览中打开。",
                    ));
                }
                data.extend_from_slice(&buffer[..read]);
            }

            Ok(SftpImageFile {
                data_url: format!("data:{mime};base64,{}", BASE64.encode(data)),
            })
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

fn sftp_text_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("sftp_text_error", error.to_string())
}

fn remote_image_mime(path: &str) -> AppResult<&'static str> {
    match path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Ok("image/png"),
        Some("jpg") | Some("jpeg") => Ok("image/jpeg"),
        Some("gif") => Ok("image/gif"),
        Some("webp") => Ok("image/webp"),
        Some("bmp") => Ok("image/bmp"),
        _ => Err(AppError::new(
            "unsupported_image",
            "仅支持 PNG / JPEG / GIF / WebP / BMP 图片预览。",
        )),
    }
}

fn child_path(parent: &str, name: &str) -> AppResult<String> {
    let parent = non_empty_path(parent)?;
    let name = name.trim();
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(AppError::new(
            "sftp_invalid_name",
            "名称不能为空，且不能包含路径分隔符。",
        ));
    }
    Ok(join_path(parent, name))
}

fn non_empty_path(path: &str) -> AppResult<&str> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') {
        return Err(AppError::new("sftp_invalid_path", "远程路径无效。"));
    }
    Ok(path)
}

fn non_root_path(path: &str) -> AppResult<&str> {
    let path = non_empty_path(path)?;
    if path.trim_matches('/').is_empty() {
        return Err(AppError::new("sftp_invalid_path", "不能操作远程根目录。"));
    }
    Ok(path)
}

fn parent_path(path: &str) -> String {
    let path = path.trim_end_matches('/');
    match path.rfind('/') {
        Some(0) => "/".to_string(),
        Some(index) => path[..index].to_string(),
        None => ".".to_string(),
    }
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
