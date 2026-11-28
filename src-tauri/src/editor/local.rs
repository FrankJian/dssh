use std::{
    fs::{self, File, Metadata},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tempfile::{NamedTempFile, TempPath};

use super::text::{self, TextEncoding, TextMetadata};
use crate::error::{AppError, AppResult};

pub struct LocalText {
    pub path: String,
    pub content: String,
    pub metadata: TextMetadata,
    pub version_token: String,
    pub read_only: bool,
    pub byte_length: u64,
}

pub fn io_error(error: std::io::Error) -> AppError {
    let message = match error.kind() {
        std::io::ErrorKind::NotFound => "文件或目录已不存在，请刷新后重试。",
        std::io::ErrorKind::PermissionDenied => "没有访问该文件或目录的权限。",
        std::io::ErrorKind::AlreadyExists => "目标已存在，请重新确认是否覆盖。",
        _ => "文件操作失败，请检查磁盘空间、权限和文件占用后重试。",
    };
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "editor_missing",
        std::io::ErrorKind::PermissionDenied => "editor_permission",
        std::io::ErrorKind::AlreadyExists => "editor_exists",
        _ => "editor_file_io",
    };
    AppError::new(code, message)
}

pub fn list(path: &Path) -> AppResult<crate::sftp::SftpListing> {
    list_bounded(path, usize::MAX).map(|(listing, _)| listing)
}

pub fn list_bounded(path: &Path, limit: usize) -> AppResult<(crate::sftp::SftpListing, bool)> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "editor_absolute_path",
            "请选择绝对目录路径。",
        ));
    }
    let path = fs::canonicalize(path).map_err(io_error)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(&path).map_err(io_error)? {
        if entries.len() >= limit {
            truncated = true;
            break;
        }
        let entry = entry.map_err(io_error)?;
        let attributes = fs::symlink_metadata(entry.path()).map_err(io_error)?;
        entries.push(crate::sftp::SftpEntry {
            name: entry
                .file_name()
                .to_str()
                .ok_or_else(|| AppError::new("editor_path_encoding", "目录包含不支持的文件名。"))?
                .to_owned(),
            path: display_path(&entry.path())?,
            is_dir: attributes.is_dir(),
            is_symlink: attributes.file_type().is_symlink(),
            size: attributes.len(),
            modified: attributes
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .and_then(|t| i64::try_from(t.as_secs()).ok()),
        });
    }
    Ok((
        crate::sftp::SftpListing {
            path: display_path(&path)?,
            entries,
        },
        truncated,
    ))
}

pub fn conflict() -> AppError {
    AppError::new(
        "editor_conflict",
        "文件已在外部修改、删除或替换，请先比较、重新加载或另存为。",
    )
}

pub fn display_path(path: &Path) -> AppResult<String> {
    let value = path
        .to_str()
        .ok_or_else(|| AppError::new("editor_path_encoding", "暂不支持非 Unicode 文件路径。"))?;
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return Ok(format!(r"\\{unc}"));
        }
        if let Some(normal) = value.strip_prefix(r"\\?\") {
            return Ok(normal.to_owned());
        }
    }
    Ok(value.to_owned())
}

pub fn canonical_target(path: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "editor_absolute_path",
            "请选择绝对文件路径。",
        ));
    }
    let name = path
        .file_name()
        .ok_or_else(|| AppError::new("editor_invalid_path", "请选择有效文件名。"))?;
    let parent = fs::canonicalize(
        path.parent()
            .ok_or_else(|| AppError::new("editor_invalid_path", "请选择有效目录。"))?,
    )
    .map_err(io_error)?;
    Ok(parent.join(name))
}

/// Existing aliases share one lock even on case-insensitive local volumes.
pub fn save_lock_key(path: &Path) -> AppResult<String> {
    #[cfg(unix)]
    if let Ok(metadata) = fs::symlink_metadata(path) {
        use std::os::unix::fs::MetadataExt;
        return Ok(format!("inode:{}:{}", metadata.dev(), metadata.ino()));
    }
    let key = display_path(path)?;
    #[cfg(windows)]
    let key = key.to_lowercase();
    Ok(format!("path:{key}"))
}

fn regular_file(path: &Path) -> AppResult<File> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if !metadata.file_type().is_file() {
        return Err(AppError::new(
            "editor_regular_file",
            "只能编辑普通文件；符号链接请先打开其真实目标。",
        ));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(conflict());
    }
    Ok(file)
}

fn fingerprint(metadata: &Metadata) -> String {
    let value = format!(
        "{:?}:{:?}:{}:{}",
        metadata.modified(),
        metadata.created(),
        metadata.len(),
        metadata.permissions().readonly()
    );
    #[cfg(unix)]
    let value = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{value}:{}:{}:{}:{}:{}:{}:{}",
            metadata.dev(),
            metadata.ino(),
            metadata.mode(),
            metadata.uid(),
            metadata.gid(),
            metadata.ctime(),
            metadata.ctime_nsec()
        )
    };
    value
}

pub fn version_token(source: &str, path: &str, identity: &str, data: &[u8]) -> String {
    let mut hash = Sha256::new();
    for value in [
        source.as_bytes(),
        path.as_bytes(),
        identity.as_bytes(),
        data,
    ] {
        hash.update((value.len() as u64).to_le_bytes());
        hash.update(value);
    }
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn read_bytes(path: &Path, allow_large: bool) -> AppResult<(Vec<u8>, File, Metadata)> {
    let mut file = regular_file(path)?;
    let before = file.metadata().map_err(io_error)?;
    text::check_size(before.len(), allow_large)?;
    let limit = if allow_large {
        text::MAX_TEXT_BYTES
    } else {
        text::NORMAL_TEXT_BYTES
    };
    let mut data = Vec::new();
    // Growth after stat must never bypass the byte limit.
    Read::take(&mut file, limit as u64 + 1)
        .read_to_end(&mut data)
        .map_err(io_error)?;
    text::check_size(data.len() as u64, allow_large)?;
    let after = file.metadata().map_err(io_error)?;
    let current = fs::symlink_metadata(path).map_err(|_| conflict())?;
    if fingerprint(&before) != fingerprint(&after) || fingerprint(&after) != fingerprint(&current) {
        return Err(conflict());
    }
    Ok((data, file, after))
}

pub fn read(
    path: &Path,
    encoding: Option<TextEncoding>,
    allow_large: bool,
) -> AppResult<LocalText> {
    let path = canonical_target(path)?;
    let display = display_path(&path)?;
    let (data, _, metadata) = read_bytes(&path, allow_large)?;
    let decoded = text::decode(&display, &data, encoding)?;
    Ok(LocalText {
        version_token: version_token("local", &display, &fingerprint(&metadata), &data),
        path: display,
        content: decoded.content,
        metadata: decoded.metadata,
        read_only: metadata.permissions().readonly(),
        byte_length: data.len() as u64,
    })
}

pub fn current_version(path: &Path) -> AppResult<String> {
    let path = canonical_target(path)?;
    let (data, _, metadata) = read_bytes(&path, true)?;
    Ok(version_token(
        "local",
        &display_path(&path)?,
        &fingerprint(&metadata),
        &data,
    ))
}

pub fn inspect(path: &Path) -> AppResult<(String, Option<String>, bool, u64)> {
    let path = canonical_target(path)?;
    let display = display_path(&path)?;
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((display, None, false, 0)),
        Err(error) => Err(io_error(error)),
        Ok(_) => {
            let (data, _, metadata) = read_bytes(&path, true)?;
            Ok((
                display.clone(),
                Some(version_token(
                    "local",
                    &display,
                    &fingerprint(&metadata),
                    &data,
                )),
                metadata.permissions().readonly(),
                data.len() as u64,
            ))
        }
    }
}

fn verify_version(path: &Path, expected: Option<&str>) -> AppResult<Option<File>> {
    match expected {
        Some(expected) => {
            let (data, file, metadata) = read_bytes(path, true).map_err(|error| {
                if !path.exists() || error.code == "editor_regular_file" {
                    conflict()
                } else {
                    error
                }
            })?;
            if metadata.permissions().readonly() {
                return Err(AppError::new(
                    "editor_read_only",
                    "文件只读，请选择另存为。",
                ));
            }
            if version_token(
                "local",
                &display_path(path)?,
                &fingerprint(&metadata),
                &data,
            ) != expected
            {
                return Err(conflict());
            }
            Ok(Some(file))
        }
        None => match fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Ok(_) => Err(conflict()),
            Err(error) => Err(io_error(error)),
        },
    }
}

#[cfg(target_os = "macos")]
fn preserve_metadata(source: &File, destination: &File) -> AppResult<()> {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn fcopyfile(from: i32, to: i32, state: *mut std::ffi::c_void, flags: u32) -> i32;
    }
    // COPYFILE_METADATA = ACL | STAT | XATTR, from the platform copyfile.h.
    // SAFETY: Both descriptors are live regular files; the null state selects defaults.
    if unsafe {
        fcopyfile(
            source.as_raw_fd(),
            destination.as_raw_fd(),
            std::ptr::null_mut(),
            7,
        )
    } != 0
    {
        return Err(AppError::new(
            "editor_metadata",
            "无法保留原文件的权限或扩展属性，请选择另存为。",
        ));
    }
    destination
        .set_modified(std::time::SystemTime::now())
        .map_err(io_error)
}

#[cfg(not(target_os = "macos"))]
fn preserve_metadata(source: &File, destination: &File) -> AppResult<()> {
    destination
        .set_permissions(source.metadata().map_err(io_error)?.permissions())
        .map_err(io_error)
}

fn cleanup_error(error: AppError, temp: NamedTempFile) -> AppError {
    cleanup_path_error(error, temp.into_temp_path())
}

fn cleanup_path_error(mut error: AppError, temp: TempPath) -> AppError {
    let path = temp.to_path_buf();
    if temp.close().is_err() {
        error
            .message
            .push_str(" 临时文件未能删除，请稍后重试清理。");
        error.details = Some(serde_json::json!({ "cleanupPath": display_path(&path).ok() }));
    }
    error
}

fn commit(temp: NamedTempFile, path: &Path, replacing: bool) -> AppResult<()> {
    if !replacing {
        return temp.persist_noclobber(path).map(|_| ()).map_err(|error| {
            let message = if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                conflict()
            } else {
                io_error(error.error)
            };
            cleanup_error(message, error.file)
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        // ReplaceFileW opens the replacement without sharing. Drop our file
        // handle first, but keep path ownership for cleanup if replacement fails.
        let mut temp = temp.into_temp_path();
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn SetFileAttributesW(path: *const u16, attributes: u32) -> i32;
            fn ReplaceFileW(
                replaced: *const u16,
                replacement: *const u16,
                backup: *const u16,
                flags: u32,
                exclude: *mut std::ffi::c_void,
                reserved: *mut std::ffi::c_void,
            ) -> i32;
        }
        let original: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let replacement: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        // Like tempfile's normal persist path, clear FILE_ATTRIBUTE_TEMPORARY
        // on our newly created staging file before it becomes the user's file.
        // SAFETY: The UTF-16 path is terminated and alive for this call.
        const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
        if unsafe { SetFileAttributesW(replacement.as_ptr(), FILE_ATTRIBUTE_NORMAL) } == 0 {
            return Err(cleanup_path_error(
                io_error(std::io::Error::last_os_error()),
                temp,
            ));
        }
        // ReplaceFileW preserves the replaced file's ACL and other Windows metadata.
        // SAFETY: All strings are terminated and alive; optional arguments are null.
        if unsafe {
            ReplaceFileW(
                original.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(cleanup_path_error(
                io_error(std::io::Error::last_os_error()),
                temp,
            ));
        }
        // The old temporary pathname is gone. Do not try to delete a new file
        // another process might subsequently create at that now-vacant path.
        temp.disable_cleanup(true);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        temp.persist(path)
            .map(|_| ())
            .map_err(|error| cleanup_error(io_error(error.error), error.file))
    }
}

pub fn save(
    path: &Path,
    content: &str,
    metadata: &TextMetadata,
    expected: Option<&str>,
) -> AppResult<String> {
    save_impl(
        path,
        content,
        metadata,
        expected,
        |file, bytes| file.write_all(bytes),
        || Ok(()),
    )
}

pub fn save_authorized(
    path: &Path,
    content: &str,
    metadata: &TextMetadata,
    expected: Option<&str>,
    guard: impl FnOnce() -> AppResult<()>,
) -> AppResult<String> {
    save_impl(
        path,
        content,
        metadata,
        expected,
        |file, bytes| file.write_all(bytes),
        guard,
    )
}

fn save_impl(
    path: &Path,
    content: &str,
    metadata: &TextMetadata,
    expected: Option<&str>,
    write: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
    before_commit: impl FnOnce() -> AppResult<()>,
) -> AppResult<String> {
    let path = canonical_target(path)?;
    if crate::sftp::is_known_binary_path(&display_path(&path)?) {
        return Err(AppError::new(
            "editor_binary",
            "此文件格式不能作为文本保存。",
        ));
    }
    let original = verify_version(&path, expected)?;
    let bytes = text::encode(content, metadata)?;
    let mut temp = tempfile::Builder::new()
        .prefix(".duo-ssh-edit-")
        .tempfile_in(path.parent().ok_or_else(conflict)?)
        .map_err(io_error)?;
    let prepared = (|| {
        write(temp.as_file_mut(), &bytes).map_err(io_error)?;
        temp.as_file().sync_all().map_err(io_error)?;
        if let Some(ref file) = original {
            preserve_metadata(file, temp.as_file())?;
        }
        temp.as_file().sync_all().map_err(io_error)?;
        before_commit()?;
        verify_version(&path, expected)?;
        Ok(())
    })();
    if let Err(error) = prepared {
        return Err(cleanup_error(error, temp));
    }
    commit(temp, &path, original.is_some())?;
    let (actual, _, saved_metadata) = read_bytes(&path, true)?;
    if actual != bytes {
        return Err(conflict());
    }
    Ok(version_token(
        "local",
        &display_path(&path)?,
        &fingerprint(&saved_metadata),
        &bytes,
    ))
}

#[cfg(test)]
mod tests {
    use super::super::text::{LineEnding, TextEncoding};
    use super::*;

    fn metadata() -> TextMetadata {
        TextMetadata {
            encoding: TextEncoding::Utf8,
            bom: false,
            line_ending: LineEnding::Lf,
        }
    }

    #[test]
    fn version_token_keeps_the_existing_sha256_encoding() {
        assert_eq!(
            version_token("local", "/fixture.txt", "metadata", b"content"),
            "05742f98c334b3865467b1f9d73cfde5abb24ad7e28c5dc3d720cd43909d7070"
        );
    }

    #[test]
    fn cleanup_failure_retains_original_and_reports_the_temporary_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "original").unwrap();
        let token = current_version(&path).unwrap();
        let error = save_impl(
            &path,
            "changed",
            &metadata(),
            Some(&token),
            |f, b| f.write_all(b),
            || {
                let temporary = fs::read_dir(dir.path())
                    .unwrap()
                    .map(|e| e.unwrap().path())
                    .find(|p| {
                        p.file_name()
                            .unwrap()
                            .to_string_lossy()
                            .starts_with(".duo-ssh-edit-")
                    })
                    .unwrap();
                fs::remove_file(&temporary).unwrap();
                fs::create_dir(temporary).unwrap();
                Err(AppError::new("injected", "模拟提交前故障"))
            },
        )
        .unwrap_err();
        assert!(error.message.contains("临时文件未能删除"));
        assert!(
            error.details.unwrap()["cleanupPath"]
                .as_str()
                .unwrap()
                .contains(".duo-ssh-edit-")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn denied_replacement_preserves_original_and_reports_cleanup_failure() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "original").unwrap();
        let token = current_version(&path).unwrap();
        let result = save_impl(
            &path,
            "changed",
            &metadata(),
            Some(&token),
            |f, b| f.write_all(b),
            || {
                fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
                Ok(())
            },
        );
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let error = result.unwrap_err();
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(error.code, "editor_permission");
        let leftover = error.details.unwrap()["cleanupPath"]
            .as_str()
            .unwrap()
            .to_owned();
        fs::remove_file(leftover).unwrap();
    }

    #[test]
    fn revoked_authorization_before_commit_does_not_write_the_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "original").unwrap();
        let token = current_version(&path).unwrap();
        assert!(
            save_authorized(&path, "changed", &metadata(), Some(&token), || Err(
                AppError::new("closed", "工作区已关闭")
            ))
            .is_err()
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn hardlink_aliases_share_the_same_save_lock_key() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs::write(&a, "same").unwrap();
        fs::hard_link(&a, &b).unwrap();
        assert_eq!(save_lock_key(&a).unwrap(), save_lock_key(&b).unwrap());
    }

    #[test]
    fn save_is_versioned_and_preserves_original_until_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("文件.txt");
        fs::write(&path, "old").unwrap();
        let initial = read(&path, None, false).unwrap();
        let token = save(&path, "new", &metadata(), Some(&initial.version_token)).unwrap();
        assert_ne!(token, initial.version_token);
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(
            save(&path, "stale", &metadata(), Some(&initial.version_token))
                .unwrap_err()
                .code,
            "editor_conflict"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[cfg(windows)]
    #[test]
    fn windows_locked_target_preserves_original_cleans_staging_and_can_retry() {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("保存-😀.txt");
        fs::write(&path, "original").unwrap();
        let token = current_version(&path).unwrap();
        // Permit reads/writes, but deliberately deny delete sharing so the
        // target cannot be replaced while this external handle is open.
        let blocker = fs::OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2)
            .open(&path)
            .unwrap();
        let error = save(&path, "changed", &metadata(), Some(&token)).unwrap_err();
        assert!(matches!(
            error.code.as_str(),
            "editor_file_io" | "editor_permission"
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        drop(blocker);

        let saved = save(&path, "changed", &metadata(), Some(&token)).unwrap();
        assert_ne!(saved, token);
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        assert_eq!(fs::metadata(&path).unwrap().file_attributes() & 0x100, 0);
        assert_eq!(
            save(&path, "stale", &metadata(), Some(&token))
                .unwrap_err()
                .code,
            "editor_conflict"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed");
    }

    #[test]
    fn same_size_content_changes_and_deletion_cannot_be_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "AAAA").unwrap();
        let initial = read(&path, None, false).unwrap();
        let stamp = fs::metadata(&path).unwrap().modified().unwrap();
        fs::write(&path, "BBBB").unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(stamp)
            .unwrap();
        assert_eq!(
            save(&path, "lost", &metadata(), Some(&initial.version_token))
                .unwrap_err()
                .code,
            "editor_conflict"
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(
            save(&path, "lost", &metadata(), Some(&initial.version_token))
                .unwrap_err()
                .code,
            "editor_conflict"
        );
        assert!(!path.exists());
    }

    #[test]
    fn new_file_requires_nonexistence_and_does_not_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        save(&path, "created", &metadata(), None).unwrap();
        assert!(save(&path, "overwrite", &metadata(), None).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "created");
    }

    #[test]
    fn partial_write_failure_keeps_original_and_cleans_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "original").unwrap();
        let token = current_version(&path).unwrap();
        let result = save_impl(
            &path,
            "new content",
            &metadata(),
            Some(&token),
            |file, bytes| {
                file.write_all(&bytes[..2])?;
                Err(std::io::Error::from(std::io::ErrorKind::StorageFull))
            },
            || Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn late_external_modification_aborts_prepared_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "original").unwrap();
        let token = current_version(&path).unwrap();
        let result = save_impl(
            &path,
            "new",
            &metadata(),
            Some(&token),
            |f, b| f.write_all(b),
            || {
                fs::write(&path, "external").unwrap();
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err().code, "editor_conflict");
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn mode_is_preserved_and_symlinks_are_never_replaced() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        fs::write(&path, "original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let token = current_version(&path).unwrap();
        save(&path, "changed", &metadata(), Some(&token)).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let link = dir.path().join("link");
        symlink(&path, &link).unwrap();
        assert!(read(&link, None, false).is_err());
        assert!(save(&link, "broken", &metadata(), None).is_err());
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}
