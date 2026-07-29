use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use russh::{ChannelMsg, client};
use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, OpenFlags},
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::{
    fs::{self, File},
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    ssh::HostKeyVerifier,
    ssh::session_manager::{SshClient, authenticate, ssh_error},
};

pub const SFTP_TRANSFER_PROGRESS_EVENT: &str = "sftp://transfer-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    operation_id: String,
    profile_id: String,
    direction: TransferDirection,
    name: String,
    path: String,
    transferred: u64,
    total: Option<u64>,
    done: bool,
}

struct TransferContext<'a> {
    operation_id: &'a str,
    profile_id: &'a str,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum TransferDirection {
    Download,
    Upload,
    Delete,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpFileInfo {
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
    pub user: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDeletePreview {
    pub path: String,
    pub files: usize,
    pub directories: usize,
    pub symlinks: usize,
    pub paths: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDeleteResult {
    pub deleted: usize,
    pub total: usize,
    pub cancelled: bool,
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
    cancelled_operations: Arc<Mutex<HashSet<String>>>,
    host_keys: Arc<HostKeyVerifier>,
}

impl SftpManager {
    pub fn new(host_keys: Arc<HostKeyVerifier>) -> Self {
        Self {
            conns: Arc::new(Mutex::new(HashMap::new())),
            cancelled_operations: Arc::new(Mutex::new(HashSet::new())),
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
        operation_id: &str,
    ) -> AppResult<()> {
        let conn = self.connection(profile).await?;
        let total = conn
            .sftp
            .metadata(remote_path)
            .await
            .ok()
            .and_then(|meta| meta.size);
        let transfer = TransferContext {
            operation_id,
            profile_id: &profile.id,
        };

        let result = async {
            let mut remote = conn.sftp.open(remote_path).await.map_err(sftp_error)?;
            let write_error =
                |error: std::io::Error| AppError::new("sftp_download_error", error.to_string());
            let mut file = File::create(local_path).await.map_err(write_error)?;

            let mut buffer = vec![0u8; 64 * 1024];
            let mut transferred: u64 = 0;
            let mut last_emitted: u64 = 0;
            emit_progress(
                app,
                &transfer,
                TransferDirection::Download,
                remote_path,
                0,
                total,
                false,
            );
            loop {
                let read = remote.read(&mut buffer).await.map_err(write_error)?;
                if read == 0 {
                    break;
                }
                file.write_all(&buffer[..read]).await.map_err(write_error)?;
                transferred += read as u64;
                if transferred - last_emitted >= PROGRESS_STEP {
                    last_emitted = transferred;
                    emit_progress(
                        app,
                        &transfer,
                        TransferDirection::Download,
                        remote_path,
                        transferred,
                        total,
                        false,
                    );
                }
            }
            file.flush().await.map_err(write_error)?;
            emit_progress(
                app,
                &transfer,
                TransferDirection::Download,
                remote_path,
                transferred,
                total,
                true,
            );
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
        operation_id: &str,
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
            operation_id,
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
        app: &AppHandle,
        profile: &SshProfile,
        local_path: &str,
        remote_path: &str,
        operation_id: &str,
    ) -> AppResult<()> {
        let total = tokio::fs::metadata(local_path)
            .await
            .map_err(|error| AppError::new("sftp_upload_error", error.to_string()))?
            .len();

        let conn = self.connection(profile).await?;
        let transfer = TransferContext {
            operation_id,
            profile_id: &profile.id,
        };
        let result = async {
            let mut local = File::open(local_path)
                .await
                .map_err(|error| AppError::new("sftp_upload_error", error.to_string()))?;
            let mut file = conn
                .sftp
                .open_with_flags(
                    remote_path,
                    OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
                )
                .await
                .map_err(sftp_error)?;
            let mut buffer = vec![0u8; 64 * 1024];
            let mut transferred = 0;
            let mut last_emitted = 0;
            emit_progress(
                app,
                &transfer,
                TransferDirection::Upload,
                remote_path,
                0,
                Some(total),
                false,
            );
            loop {
                let read = local
                    .read(&mut buffer)
                    .await
                    .map_err(|error| AppError::new("sftp_upload_error", error.to_string()))?;
                if read == 0 {
                    break;
                }
                file.write_all(&buffer[..read]).await.map_err(sftp_error)?;
                transferred += read as u64;
                if transferred - last_emitted >= PROGRESS_STEP {
                    last_emitted = transferred;
                    emit_progress(
                        app,
                        &transfer,
                        TransferDirection::Upload,
                        remote_path,
                        transferred,
                        Some(total),
                        false,
                    );
                }
            }
            file.shutdown().await.map_err(sftp_error)?;
            emit_progress(
                app,
                &transfer,
                TransferDirection::Upload,
                remote_path,
                transferred,
                Some(total),
                true,
            );
            Ok(())
        }
        .await;

        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    /// Recursively copy a local directory into `remote_path`. Existing target
    /// directories are merged and files of the same name are replaced, matching
    /// the ordinary single-file upload semantics.
    pub async fn upload_dir(
        &self,
        app: &AppHandle,
        profile: &SshProfile,
        local_path: &str,
        remote_path: &str,
        operation_id: &str,
    ) -> AppResult<()> {
        let root = PathBuf::from(local_path);
        let metadata = fs::symlink_metadata(&root)
            .await
            .map_err(local_file_transfer_error)?;
        if !metadata.is_dir() {
            return Err(AppError::new(
                "sftp_upload_error",
                "上传目录的本机路径不是目录。",
            ));
        }

        let conn = self.connection(profile).await?;
        let result = async {
            ensure_remote_dir(&conn.sftp, remote_path).await?;
            let mut pending_dirs = vec![(root, remote_path.to_string())];
            let mut files = Vec::new();
            while let Some((local_dir, remote_dir)) = pending_dirs.pop() {
                let mut directory = fs::read_dir(&local_dir)
                    .await
                    .map_err(local_file_transfer_error)?;
                while let Some(entry) = directory
                    .next_entry()
                    .await
                    .map_err(local_file_transfer_error)?
                {
                    let file_type = entry.file_type().await.map_err(local_file_transfer_error)?;
                    let local_child = entry.path();
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if file_type.is_symlink() {
                        return Err(AppError::new(
                            "sftp_upload_error",
                            format!("目录上传不支持符号链接：{}", local_child.display()),
                        ));
                    }
                    let remote_child = join_path(&remote_dir, &name);
                    if file_type.is_dir() {
                        ensure_remote_dir(&conn.sftp, &remote_child).await?;
                        pending_dirs.push((local_child, remote_child));
                    } else if file_type.is_file() {
                        files.push((local_child, remote_child));
                    }
                }
            }

            for (local_file, remote_file) in files {
                self.upload(
                    app,
                    profile,
                    &local_file.to_string_lossy(),
                    &remote_file,
                    operation_id,
                )
                .await?;
            }
            Ok(())
        }
        .await;
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    /// Recursively copy a remote directory into `local_path` through SFTP.
    /// This avoids shelling out remotely, so it uses the normal TOFU-verified
    /// SFTP connection on all supported servers.
    pub async fn download_tree(
        &self,
        app: &AppHandle,
        profile: &SshProfile,
        remote_path: &str,
        local_path: &str,
        operation_id: &str,
    ) -> AppResult<()> {
        let result = async {
            let root = PathBuf::from(local_path);
            fs::create_dir_all(&root)
                .await
                .map_err(local_file_transfer_error)?;
            let mut pending_dirs = vec![(remote_path.to_string(), root)];
            while let Some((remote_dir, local_dir)) = pending_dirs.pop() {
                let listing = self.list(profile, &remote_dir).await?;
                for entry in listing.entries {
                    let local_child = local_child_path(&local_dir, &entry.name)?;
                    if entry.is_symlink {
                        return Err(AppError::new(
                            "sftp_download_error",
                            format!("目录下载不支持符号链接：{}", entry.path),
                        ));
                    }
                    if entry.is_dir {
                        fs::create_dir_all(&local_child)
                            .await
                            .map_err(local_file_transfer_error)?;
                        pending_dirs.push((entry.path, local_child));
                    } else {
                        self.download(
                            app,
                            profile,
                            &entry.path,
                            &local_child.to_string_lossy(),
                            operation_id,
                        )
                        .await?;
                    }
                }
            }
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

    pub async fn file_info(
        &self,
        profile: &SshProfile,
        remote_path: &str,
    ) -> AppResult<SftpFileInfo> {
        let conn = self.connection(profile).await?;
        let result = async {
            let metadata = conn
                .sftp
                .symlink_metadata(remote_path)
                .await
                .map_err(sftp_error)?;
            let canonical = conn
                .sftp
                .canonicalize(remote_path)
                .await
                .map(|path| normalize_dir(&path))
                .unwrap_or_else(|_| normalize_dir(remote_path));
            Ok(SftpFileInfo {
                path: canonical,
                is_dir: metadata.is_dir(),
                is_symlink: metadata.file_type().is_symlink(),
                size: metadata.size.unwrap_or(0),
                modified: metadata.mtime.map(i64::from),
                permissions: metadata.permissions,
                user: metadata.user,
                group: metadata.group,
            })
        }
        .await;
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn set_permissions(
        &self,
        profile: &SshProfile,
        remote_path: &str,
        permissions: u32,
    ) -> AppResult<()> {
        if permissions > 0o7777 {
            return Err(AppError::new(
                "sftp_invalid_permissions",
                "权限必须是有效的八进制值。",
            ));
        }
        let conn = self.connection(profile).await?;
        let mut metadata = FileAttributes::empty();
        metadata.permissions = Some(permissions);
        let result = conn
            .sftp
            .set_metadata(remote_path, metadata)
            .await
            .map_err(sftp_error);
        if result.is_err() {
            self.drop_connection(&profile.id).await;
        }
        result
    }

    pub async fn move_entries(
        &self,
        profile: &SshProfile,
        sources: &[String],
        target_dir: &str,
    ) -> AppResult<Vec<String>> {
        if sources.is_empty() {
            return Err(AppError::new("sftp_move_error", "请选择要移动的文件。"));
        }
        let conn = self.connection(profile).await?;
        let target_meta = conn
            .sftp
            .symlink_metadata(target_dir)
            .await
            .map_err(sftp_error)?;
        if !target_meta.is_dir() || target_meta.file_type().is_symlink() {
            return Err(AppError::new("sftp_move_error", "目标必须是普通目录。"));
        }
        let target = conn
            .sftp
            .canonicalize(target_dir)
            .await
            .map(|path| normalize_dir(&path))
            .unwrap_or_else(|_| normalize_dir(target_dir));
        let mut seen = HashSet::new();
        let mut moves = Vec::with_capacity(sources.len());
        for source in sources {
            let source = non_root_path(source)?;
            if !seen.insert(source.to_string()) {
                continue;
            }
            let metadata = conn
                .sftp
                .symlink_metadata(source)
                .await
                .map_err(sftp_error)?;
            let name = path_name(source);
            let destination = join_path(&target, name);
            if destination == source || (metadata.is_dir() && is_descendant(&destination, source)) {
                return Err(AppError::new(
                    "sftp_move_error",
                    "不能移动到自身或其子目录。",
                ));
            }
            if conn.sftp.symlink_metadata(&destination).await.is_ok() {
                return Err(AppError::new(
                    "sftp_move_conflict",
                    format!("目标已存在同名项目：{destination}"),
                ));
            }
            moves.push((source.to_string(), destination));
        }
        for (source, destination) in &moves {
            conn.sftp
                .rename(source, destination)
                .await
                .map_err(sftp_error)?;
        }
        Ok(moves
            .into_iter()
            .map(|(_, destination)| destination)
            .collect())
    }

    pub async fn delete_preview(
        &self,
        profile: &SshProfile,
        remote_path: &str,
    ) -> AppResult<SftpDeletePreview> {
        let conn = self.connection(profile).await?;
        let target = self.safe_recursive_target(&conn, remote_path).await?;
        let plan = collect_delete_plan(&conn.sftp, &target).await?;
        Ok(delete_preview(&target, &plan))
    }

    pub async fn delete_recursive(
        &self,
        app: &AppHandle,
        profile: &SshProfile,
        remote_path: &str,
        operation_id: &str,
    ) -> AppResult<SftpDeleteResult> {
        let conn = self.connection(profile).await?;
        let target = self.safe_recursive_target(&conn, remote_path).await?;
        let plan = collect_delete_plan(&conn.sftp, &target).await?;
        let total = plan.len() as u64;
        let transfer = TransferContext {
            operation_id,
            profile_id: &profile.id,
        };
        self.cancelled_operations.lock().await.remove(operation_id);
        emit_progress(
            app,
            &transfer,
            TransferDirection::Delete,
            &target,
            0,
            Some(total),
            false,
        );
        let mut deleted = 0usize;
        for item in &plan {
            if self
                .cancelled_operations
                .lock()
                .await
                .contains(operation_id)
            {
                self.cancelled_operations.lock().await.remove(operation_id);
                return Ok(SftpDeleteResult {
                    deleted,
                    total: plan.len(),
                    cancelled: true,
                });
            }
            let result = if item.is_dir {
                conn.sftp.remove_dir(&item.path).await
            } else {
                conn.sftp.remove_file(&item.path).await
            };
            result.map_err(sftp_error)?;
            deleted += 1;
            emit_progress(
                app,
                &transfer,
                TransferDirection::Delete,
                &target,
                deleted as u64,
                Some(total),
                deleted == plan.len(),
            );
        }
        self.cancelled_operations.lock().await.remove(operation_id);
        Ok(SftpDeleteResult {
            deleted,
            total: plan.len(),
            cancelled: false,
        })
    }

    pub async fn cancel_operation(&self, operation_id: &str) {
        self.cancelled_operations
            .lock()
            .await
            .insert(operation_id.to_string());
    }

    async fn safe_recursive_target(&self, conn: &SftpConn, remote_path: &str) -> AppResult<String> {
        let source = non_root_path(remote_path)?;
        let source_metadata = conn
            .sftp
            .symlink_metadata(source)
            .await
            .map_err(sftp_error)?;
        // A symlink is deleted as the link itself. Canonicalizing it would follow
        // its target and could turn a link deletion into a recursive deletion.
        let target = if source_metadata.file_type().is_symlink() {
            normalize_dir(source)
        } else {
            conn.sftp
                .canonicalize(source)
                .await
                .map(|path| normalize_dir(&path))
                .map_err(sftp_error)?
        };
        let home = conn
            .sftp
            .canonicalize(".")
            .await
            .map(|path| normalize_dir(&path))
            .map_err(sftp_error)?;
        if target == "/" || target == home {
            return Err(AppError::new(
                "sftp_protected_path",
                "不能递归删除根目录或远程主目录。",
            ));
        }
        Ok(target)
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
    operation_id: &str,
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
    let transfer = TransferContext {
        operation_id,
        profile_id,
    };
    // The compressed size is unknown up front, so total stays None (indeterminate).
    emit_progress(
        app,
        &transfer,
        TransferDirection::Download,
        remote_path,
        0,
        None,
        false,
    );

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => {
                file.write_all(&data[..]).await.map_err(write_error)?;
                transferred += data.len() as u64;
                if transferred - last_emitted >= PROGRESS_STEP {
                    last_emitted = transferred;
                    emit_progress(
                        app,
                        &transfer,
                        TransferDirection::Download,
                        remote_path,
                        transferred,
                        None,
                        false,
                    );
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

    emit_progress(
        app,
        &transfer,
        TransferDirection::Download,
        remote_path,
        transferred,
        None,
        true,
    );
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    transfer: &TransferContext<'_>,
    direction: TransferDirection,
    path: &str,
    transferred: u64,
    total: Option<u64>,
    done: bool,
) {
    let _ = app.emit(
        SFTP_TRANSFER_PROGRESS_EVENT,
        TransferProgress {
            operation_id: transfer.operation_id.to_string(),
            profile_id: transfer.profile_id.to_string(),
            direction,
            name: transfer_name(path),
            path: path.to_string(),
            transferred,
            total,
            done,
        },
    );
}

fn transfer_name(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

const MAX_DELETE_ENTRIES: usize = 10_000;
const MAX_DELETE_DEPTH: usize = 64;
const MAX_DELETE_PREVIEW_PATHS: usize = 100;

struct DeletePlanItem {
    path: String,
    is_dir: bool,
    is_symlink: bool,
}

async fn collect_delete_plan(sftp: &SftpSession, root: &str) -> AppResult<Vec<DeletePlanItem>> {
    let mut stack = vec![(root.to_string(), true, 0usize)];
    let mut plan = Vec::new();
    let mut discovered = 0usize;
    while let Some((path, visit_children, depth)) = stack.pop() {
        if visit_children {
            discovered += 1;
        }
        if discovered > MAX_DELETE_ENTRIES {
            return Err(AppError::new(
                "sftp_delete_limit",
                "目录条目超过 10000，无法安全递归删除。",
            ));
        }
        if depth > MAX_DELETE_DEPTH {
            return Err(AppError::new(
                "sftp_delete_limit",
                "目录层级超过 64，无法安全递归删除。",
            ));
        }
        if !visit_children {
            plan.push(DeletePlanItem {
                path,
                is_dir: true,
                is_symlink: false,
            });
            continue;
        }
        let metadata = sftp.symlink_metadata(&path).await.map_err(sftp_error)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            plan.push(DeletePlanItem {
                path,
                is_dir: false,
                is_symlink: metadata.file_type().is_symlink(),
            });
            continue;
        }
        let entries = sftp.read_dir(&path).await.map_err(sftp_error)?;
        stack.push((path.clone(), false, depth));
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            stack.push((join_path(&path, &name), true, depth + 1));
        }
    }
    Ok(plan)
}

fn delete_preview(path: &str, plan: &[DeletePlanItem]) -> SftpDeletePreview {
    let mut files = 0;
    let mut directories = 0;
    let mut symlinks = 0;
    for item in plan {
        if item.is_symlink {
            symlinks += 1;
        } else if item.is_dir {
            directories += 1;
        } else {
            files += 1;
        }
    }
    SftpDeletePreview {
        path: path.to_string(),
        files,
        directories,
        symlinks,
        paths: plan
            .iter()
            .take(MAX_DELETE_PREVIEW_PATHS)
            .map(|item| item.path.clone())
            .collect(),
        truncated: plan.len() > MAX_DELETE_PREVIEW_PATHS,
    }
}

fn path_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}

fn is_descendant(path: &str, ancestor: &str) -> bool {
    let prefix = format!("{}/", ancestor.trim_end_matches('/'));
    path.starts_with(&prefix)
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

fn local_file_transfer_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("sftp_local_transfer_error", error.to_string())
}

async fn ensure_remote_dir(sftp: &SftpSession, path: &str) -> AppResult<()> {
    match sftp.metadata(path).await {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(AppError::new(
            "sftp_upload_error",
            format!("远程目标已存在且不是目录：{path}"),
        )),
        Err(_) => match sftp.create_dir(path).await {
            Ok(()) => Ok(()),
            Err(create_error) => match sftp.metadata(path).await {
                Ok(metadata) if metadata.is_dir() => Ok(()),
                _ => Err(sftp_error(create_error)),
            },
        },
    }
}

fn local_child_path(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let child = Path::new(name);
    if child.components().count() != 1
        || !matches!(child.components().next(), Some(Component::Normal(_)))
    {
        return Err(AppError::new(
            "sftp_download_error",
            format!("远程条目名称不安全，无法写入本机：{name}"),
        ));
    }
    Ok(parent.join(child))
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

#[cfg(test)]
mod tests {
    use super::{DeletePlanItem, delete_preview, is_descendant};

    #[test]
    fn delete_preview_counts_symlinks_without_treating_them_as_directories() {
        let plan = vec![
            DeletePlanItem {
                path: "/tmp/link".to_string(),
                is_dir: false,
                is_symlink: true,
            },
            DeletePlanItem {
                path: "/tmp/file".to_string(),
                is_dir: false,
                is_symlink: false,
            },
            DeletePlanItem {
                path: "/tmp/dir".to_string(),
                is_dir: true,
                is_symlink: false,
            },
        ];
        let preview = delete_preview("/tmp", &plan);
        assert_eq!(preview.files, 1);
        assert_eq!(preview.directories, 1);
        assert_eq!(preview.symlinks, 1);
    }

    #[test]
    fn descendant_check_does_not_match_sibling_prefixes() {
        assert!(is_descendant(
            "/home/user/project/src",
            "/home/user/project"
        ));
        assert!(!is_descendant(
            "/home/user/project-old",
            "/home/user/project"
        ));
    }
}
