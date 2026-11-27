//! Versioned editor I/O uses a short-lived subsystem on the existing pool.
//! Raw SFTP is needed for posix-rename, not exposed by the high-level client.
use russh_sftp::{
    client::{RawSftpSession, error::Error as SftpError},
    protocol::{FileAttributes, OpenFlags, Packet, StatusCode},
};

use super::SftpManager;
use crate::{
    editor::{
        local::{conflict, version_token},
        text,
        workspaces::WorkspaceLease,
    },
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    ssh::{ChannelLease, ChannelOwner, ConnectionLease},
};

pub struct EditorSftpSession {
    io: EditorSftpIo,
    _channel: ChannelLease,
    _transport: ConnectionLease,
}

#[cfg(test)]
#[path = "editor_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "editor_openssh_tests.rs"]
mod openssh_tests;

#[cfg(all(test, unix))]
#[path = "editor_remote_tests.rs"]
mod remote_tests;

pub struct EditorSftpIo {
    raw: RawSftpSession,
    atomic_rename: bool,
}

impl std::ops::Deref for EditorSftpSession {
    type Target = EditorSftpIo;
    fn deref(&self) -> &Self::Target {
        &self.io
    }
}

pub struct RemoteBytes {
    pub path: String,
    pub data: Vec<u8>,
    pub attributes: FileAttributes,
    pub version: String,
}

fn failure(error: SftpError) -> AppError {
    let (code, message) = match error {
        SftpError::Status(status) if status.status_code == StatusCode::NoSuchFile => {
            ("editor_missing", "远程文件或目录不存在，请刷新后重试。")
        }
        SftpError::Status(status) if status.status_code == StatusCode::PermissionDenied => {
            ("editor_permission", "没有读写该远程文件的权限。")
        }
        SftpError::Timeout => (
            "editor_sftp_timeout",
            "远程文件操作超时，请检查连接后重试。",
        ),
        _ => (
            "editor_sftp",
            "远程文件操作失败，请检查连接、服务端权限和文件占用后重试。",
        ),
    };
    AppError::new(code, message)
}

fn metadata_identity(attributes: &FileAttributes) -> String {
    // SFTP v3 exposes no universal inode/file-id; do not claim distributed CAS.
    format!(
        "{:?}:{:?}:{:?}:{:?}:{:?}",
        attributes.size, attributes.uid, attributes.gid, attributes.permissions, attributes.mtime
    )
}

fn string_packet(values: &[&str]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for value in values {
        bytes.extend_from_slice(&(value.len() as u32).to_be_bytes());
        bytes.extend_from_slice(value.as_bytes());
    }
    bytes
}

fn status_reply(packet: Packet) -> AppResult<()> {
    match packet {
        Packet::Status(status) if status.status_code == StatusCode::Ok => Ok(()),
        Packet::Status(status) => Err(failure(SftpError::Status(status))),
        _ => Err(AppError::new(
            "editor_sftp_reply",
            "服务器返回了无效的文件操作结果。",
        )),
    }
}

impl Drop for EditorSftpIo {
    fn drop(&mut self) {
        let _ = self.raw.close_session();
    }
}

impl SftpManager {
    pub async fn editor_session(&self, profile: &SshProfile) -> AppResult<EditorSftpSession> {
        let transport = self
            .pool
            .acquire(profile.clone(), ChannelOwner::Sftp)
            .await?;
        let (channel, channel_lease) = transport.open_session_channel().await?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|_| AppError::new("editor_sftp_subsystem", "此连接未开放 SFTP 子系统。"))?;
        Ok(EditorSftpSession {
            io: EditorSftpIo::new(channel.into_stream()).await?,
            _channel: channel_lease,
            _transport: transport,
        })
    }
}

impl EditorSftpIo {
    pub async fn list_bounded(
        &self,
        path: &str,
        limit: usize,
        lease: &WorkspaceLease,
    ) -> AppResult<(super::SftpListing, bool)> {
        lease.ensure_active()?;
        let attributes = self.raw.lstat(path).await.map_err(failure)?.attrs;
        if !attributes.file_type().is_dir() {
            return Err(AppError::new(
                "editor_scan_directory",
                "搜索不会跟随目录符号链接。",
            ));
        }
        let handle = self.raw.opendir(path).await.map_err(failure)?.handle;
        let result = async {
            let mut entries = Vec::new();
            let mut truncated = false;
            'read: loop {
                lease.ensure_active()?;
                match self.raw.readdir(&handle).await {
                    Ok(reply) => {
                        if reply.files.is_empty() {
                            break;
                        }
                        for file in reply.files {
                            if file.filename == "." || file.filename == ".." {
                                continue;
                            }
                            if file.filename.contains('/') || file.filename.contains('\0') {
                                return Err(AppError::new(
                                    "editor_sftp_path",
                                    "服务器返回了无效文件名。",
                                ));
                            }
                            if entries.len() >= limit {
                                truncated = true;
                                break 'read;
                            }
                            entries.push(super::SftpEntry {
                                path: format!("{}/{}", path.trim_end_matches('/'), file.filename),
                                name: file.filename,
                                is_dir: file.attrs.file_type().is_dir(),
                                is_symlink: file.attrs.file_type().is_symlink(),
                                size: file.attrs.size.unwrap_or(0),
                                modified: file.attrs.mtime.map(i64::from),
                            });
                        }
                    }
                    Err(SftpError::Status(status)) if status.status_code == StatusCode::Eof => {
                        break;
                    }
                    Err(error) => return Err(failure(error)),
                }
            }
            Ok((
                super::SftpListing {
                    path: path.into(),
                    entries,
                },
                truncated,
            ))
        }
        .await;
        let closed = self.raw.close(&handle).await.map_err(failure);
        let value = result?;
        closed?;
        Ok(value)
    }
    pub async fn inspect(
        &self,
        profile_id: &str,
        path: &str,
        lease: &WorkspaceLease,
    ) -> AppResult<(String, Option<String>, bool, u64)> {
        let path = self.canonical_path(path, true).await?;
        lease.ensure_active()?;
        match self.raw.lstat(&path).await {
            Err(SftpError::Status(status)) if status.status_code == StatusCode::NoSuchFile => {
                Ok((path, None, false, 0))
            }
            Err(error) => Err(failure(error)),
            Ok(_) => {
                let value = self.read(profile_id, &path, true, lease).await?;
                let readonly = value
                    .attributes
                    .permissions
                    .is_none_or(|mode| mode & 0o222 == 0);
                Ok((
                    value.path,
                    Some(value.version),
                    readonly,
                    value.data.len() as u64,
                ))
            }
        }
    }
    async fn new<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static>(
        stream: S,
    ) -> AppResult<Self> {
        let raw = RawSftpSession::new(stream);
        let version = raw.init().await.map_err(failure)?;
        Ok(Self {
            raw,
            atomic_rename: version
                .extensions
                .get("posix-rename@openssh.com")
                .is_some_and(|v| v == "1"),
        })
    }
    pub async fn check_type(&self, path: &str, directory: bool) -> AppResult<()> {
        let attrs = self.raw.stat(path).await.map_err(failure)?.attrs;
        if (directory && !attrs.file_type().is_dir())
            || (!directory && attrs.permissions.is_some() && !attrs.file_type().is_file())
        {
            return Err(AppError::new(
                "editor_path_type",
                "所选远程路径类型不正确。",
            ));
        }
        Ok(())
    }
    pub async fn canonical_path(&self, path: &str, new_target: bool) -> AppResult<String> {
        if path.contains('\0') {
            return Err(AppError::new("editor_invalid_path", "文件路径无效。"));
        }
        if new_target {
            if !path.starts_with('/') {
                return Err(AppError::new(
                    "editor_absolute_path",
                    "请选择远程绝对路径。",
                ));
            }
            let (parent, name) = path
                .rsplit_once('/')
                .ok_or_else(|| AppError::new("editor_absolute_path", "请选择远程绝对路径。"))?;
            if name.is_empty() || name == "." || name == ".." {
                return Err(AppError::new("editor_invalid_path", "请选择有效文件名。"));
            }
            let parent = self
                .canonical_path_inner(if parent.is_empty() { "/" } else { parent })
                .await?;
            Ok(format!("{}/{name}", parent.trim_end_matches('/')))
        } else {
            self.canonical_path_inner(path).await
        }
    }

    async fn canonical_path_inner(&self, path: &str) -> AppResult<String> {
        let response = self.raw.realpath(path).await.map_err(failure)?;
        let path = response
            .files
            .first()
            .map(|f| f.filename.clone())
            .filter(|path| path.starts_with('/') && !path.contains('\0'))
            .ok_or_else(|| AppError::new("editor_sftp_path", "服务器未返回有效的绝对路径。"))?;
        Ok(path)
    }

    pub async fn read(
        &self,
        profile_id: &str,
        path: &str,
        allow_large: bool,
        lease: &WorkspaceLease,
    ) -> AppResult<RemoteBytes> {
        lease.ensure_active()?;
        // Canonicalize only the parent so lstat continues to detect a final symlink.
        let path = self.canonical_path(path, true).await?;
        let attributes = self.raw.lstat(&path).await.map_err(failure)?.attrs;
        if attributes.permissions.is_some() && !attributes.file_type().is_file() {
            return Err(AppError::new(
                "editor_regular_file",
                "只能编辑普通文件；符号链接请先打开其真实目标。",
            ));
        }
        if let Some(size) = attributes.size {
            text::check_size(size, allow_large)?;
        }
        let handle = self
            .raw
            .open(&path, OpenFlags::READ, FileAttributes::empty())
            .await
            .map_err(failure)?
            .handle;
        let result = async {
            let mut data = Vec::new();
            loop {
                lease.ensure_active()?;
                match self.raw.read(&handle, data.len() as u64, 32 * 1024).await {
                    Ok(chunk) => {
                        if chunk.data.is_empty() {
                            break;
                        }
                        text::check_size((data.len() + chunk.data.len()) as u64, allow_large)?;
                        data.extend_from_slice(&chunk.data);
                    }
                    Err(SftpError::Status(status)) if status.status_code == StatusCode::Eof => {
                        break;
                    }
                    Err(error) => return Err(failure(error)),
                }
            }
            let after = self.raw.lstat(&path).await.map_err(failure)?.attrs;
            let opened = self.raw.fstat(&handle).await.map_err(failure)?.attrs;
            if metadata_identity(&attributes) != metadata_identity(&after)
                || metadata_identity(&after) != metadata_identity(&opened)
            {
                return Err(conflict());
            }
            let version = version_token(
                &format!("sftp:{profile_id}"),
                &path,
                &metadata_identity(&after),
                &data,
            );
            Ok(RemoteBytes {
                path,
                data,
                attributes: after,
                version,
            })
        }
        .await;
        let close = self.raw.close(handle).await.map_err(failure);
        let value = result?;
        close?;
        Ok(value)
    }

    async fn expected(
        &self,
        profile_id: &str,
        path: &str,
        expected: Option<&str>,
        lease: &WorkspaceLease,
    ) -> AppResult<Option<FileAttributes>> {
        if let Some(expected) = expected {
            let current = self
                .read(profile_id, path, true, lease)
                .await
                .map_err(|error| {
                    if error.code == "editor_missing" || error.code == "editor_regular_file" {
                        conflict()
                    } else {
                        error
                    }
                })?;
            if current.version != expected {
                return Err(conflict());
            }
            Ok(Some(current.attributes))
        } else {
            match self.raw.lstat(path).await {
                Err(SftpError::Status(status)) if status.status_code == StatusCode::NoSuchFile => {
                    Ok(None)
                }
                Ok(_) => Err(conflict()),
                Err(error) => Err(failure(error)),
            }
        }
    }

    pub async fn save(
        &self,
        profile_id: &str,
        path: &str,
        bytes: &[u8],
        expected: Option<&str>,
        allow_non_atomic: bool,
        lease: &WorkspaceLease,
    ) -> AppResult<String> {
        lease.ensure_active()?;
        text::check_size(bytes.len() as u64, true)?;
        if super::is_known_binary_path(path) {
            return Err(AppError::new(
                "editor_binary",
                "此文件格式不能作为文本保存。",
            ));
        }
        let path = self.canonical_path(path, true).await?;
        let original = self.expected(profile_id, &path, expected, lease).await?;
        let atomic_replace = self.atomic_rename
            && original
                .as_ref()
                .is_some_and(|attrs| attrs.permissions.is_some());
        if original.is_some() && !atomic_replace && !allow_non_atomic {
            return Err(AppError::new(
                "editor_atomic_unavailable",
                "服务器不支持安全替换。请选择另存为，或明确确认本次非原子覆盖的风险。",
            ));
        }
        let parent =
            path.rsplit_once('/').map_or(
                "/",
                |(parent, _)| if parent.is_empty() { "/" } else { parent },
            );
        let temporary = format!(
            "{}/.duo-ssh-edit-{:032x}",
            parent.trim_end_matches('/'),
            rand::random::<u128>()
        );
        let mut attributes = FileAttributes::empty();
        attributes.permissions = Some(0o100600);
        let handle = self
            .raw
            .open(
                &temporary,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
                attributes,
            )
            .await
            .map_err(failure)?
            .handle;
        let prepared: AppResult<()> = async {
            for (index, chunk) in bytes.chunks(32 * 1024).enumerate() {
                lease.ensure_active()?;
                self.raw
                    .write(&handle, (index * 32 * 1024) as u64, chunk.to_vec())
                    .await
                    .map_err(failure)?;
            }
            Ok(())
        }
        .await;
        let closed = self.raw.close(handle).await.map_err(failure);
        let result = async {
            prepared?;
            closed?;
            if let Some(ref original) = original
                && atomic_replace
            {
                let mode = original.permissions.ok_or_else(|| {
                    AppError::new(
                        "editor_metadata",
                        "服务器未提供原文件权限，无法安全替换，请选择另存为。",
                    )
                })?;
                let temp_meta = self.raw.lstat(&temporary).await.map_err(failure)?.attrs;
                let mut preserve = FileAttributes::empty();
                preserve.permissions = Some(mode);
                if original.uid != temp_meta.uid || original.gid != temp_meta.gid {
                    preserve.uid = original.uid;
                    preserve.gid = original.gid;
                }
                self.raw.setstat(&temporary, preserve).await.map_err(|_| {
                    AppError::new(
                        "editor_metadata",
                        "无法保留原文件权限或属主，请选择另存为。",
                    )
                })?;
            }
            let check = self.read(profile_id, &temporary, true, lease).await?;
            if check.data != bytes {
                return Err(AppError::new(
                    "editor_write_verify",
                    "远程临时文件校验失败，原文件未替换。",
                ));
            }
            self.expected(profile_id, &path, expected, lease).await?;
            lease.ensure_active()?;
            if original.is_some() && atomic_replace {
                status_reply(
                    self.raw
                        .extended(
                            "posix-rename@openssh.com",
                            string_packet(&[&temporary, &path]),
                        )
                        .await
                        .map_err(failure)?,
                )?;
            } else if original.is_some() {
                // Explicit one-shot fallback: the caller has confirmed possible partial writes.
                let handle = self
                    .raw
                    .open(
                        &path,
                        OpenFlags::WRITE | OpenFlags::TRUNCATE,
                        FileAttributes::empty(),
                    )
                    .await
                    .map_err(failure)?
                    .handle;
                let write_result: AppResult<()> = async {
                    for (index, chunk) in bytes.chunks(32 * 1024).enumerate() {
                        self.raw
                            .write(&handle, (index * 32 * 1024) as u64, chunk.to_vec())
                            .await
                            .map_err(failure)?;
                    }
                    Ok(())
                }
                .await;
                let closed = self.raw.close(handle).await.map_err(failure);
                write_result?;
                closed?;
                self.raw.remove(&temporary).await.map_err(failure)?;
            } else {
                self.raw.rename(&temporary, &path).await.map_err(failure)?;
            }
            let saved = self.read(profile_id, &path, true, lease).await?;
            if saved.data != bytes {
                return Err(conflict());
            }
            Ok(saved.version)
        }
        .await;
        match result {
            Ok(version) => Ok(version),
            Err(mut error) => {
                match self.raw.remove(&temporary).await {
                    Ok(_) => {}
                    Err(SftpError::Status(status))
                        if status.status_code == StatusCode::NoSuchFile => {}
                    Err(_) => {
                        error
                            .message
                            .push_str(" 临时文件未能清理，请稍后重试清理。");
                        error.details = Some(serde_json::json!({ "cleanupPath": temporary }));
                    }
                }
                if allow_non_atomic && original.is_some() && !atomic_replace {
                    error
                        .message
                        .push_str(" 本次为非原子覆盖，原文件可能已部分写入，请核对远程内容。");
                }
                Err(error)
            }
        }
    }
}
