use super::{local, workspaces::WorkspaceLease};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
pub struct FileOperation {
    pub lease: WorkspaceLease,
    pub cancel: CancellationToken,
}
impl FileOperation {
    pub fn check(&self) -> AppResult<()> {
        self.lease.ensure_active()?;
        if self.cancel.is_cancelled() {
            Err(AppError::new(
                "editor_operation_cancelled",
                "操作已停止，已完成的项目保持现状。",
            ))
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Default)]
pub struct FileOperations {
    operations: Arc<Mutex<HashMap<String, FileOperation>>>,
}
impl FileOperations {
    pub fn start(&self, lease: WorkspaceLease) -> AppResult<String> {
        lease.ensure_active()?;
        let mut operations = self.operations.lock().map_err(|_| unavailable())?;
        if operations
            .values()
            .filter(|op| op.lease.workspace.id == lease.workspace.id)
            .count()
            >= 8
        {
            return Err(AppError::new(
                "editor_operation_budget",
                "文件操作过多，请等待当前操作结束。",
            ));
        }
        let id = format!("file-operation-{:032x}", rand::random::<u128>());
        operations.insert(
            id.clone(),
            FileOperation {
                lease,
                cancel: CancellationToken::new(),
            },
        );
        Ok(id)
    }
    pub fn require(&self, owner: &str, workspace: &str, id: &str) -> AppResult<FileOperation> {
        self.operations
            .lock()
            .map_err(|_| unavailable())?
            .get(id)
            .filter(|op| op.lease.owner == owner && op.lease.workspace.id == workspace)
            .cloned()
            .ok_or_else(unavailable)
    }
    pub fn finish(&self, id: &str) {
        if let Ok(mut operations) = self.operations.lock() {
            operations.remove(id);
        }
    }
    pub fn close(&self, workspace: Option<&str>, owner: Option<&str>) {
        if let Ok(mut operations) = self.operations.lock() {
            operations.retain(|_, op| {
                if workspace.is_some_and(|id| id == op.lease.workspace.id)
                    || owner.is_some_and(|id| id == op.lease.owner)
                {
                    op.cancel.cancel();
                    false
                } else {
                    true
                }
            });
        }
    }
}
fn unavailable() -> AppError {
    AppError::new(
        "editor_operation_unavailable",
        "文件操作已结束或不属于当前窗口。",
    )
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreview {
    pub path: String,
    pub files: usize,
    pub directories: usize,
    pub symlinks: usize,
    pub paths: Vec<String>,
    pub truncated: bool,
}
#[derive(Clone)]
struct DeleteEntry {
    path: PathBuf,
    directory: bool,
}
pub fn protect_local(path: &Path, workspace_root: Option<&str>, home: &Path) -> AppResult<PathBuf> {
    let target = local::canonical_target(path)?;
    let canonical = if fs::symlink_metadata(&target)
        .map_err(local::io_error)?
        .file_type()
        .is_symlink()
    {
        target
    } else {
        fs::canonicalize(target).map_err(local::io_error)?
    };
    let protected = canonical.parent().is_none()
        || fs::canonicalize(home).is_ok_and(|home| home == canonical)
        || workspace_root
            .is_some_and(|root| fs::canonicalize(root).is_ok_and(|root| root == canonical));
    if protected {
        return Err(AppError::new(
            "editor_protected_path",
            "不能操作文件系统根目录、主目录或当前工作区根目录。",
        ));
    }
    Ok(canonical)
}
fn collect_delete(
    path: &Path,
    operation: Option<&FileOperation>,
) -> AppResult<(Vec<DeleteEntry>, DeletePreview)> {
    let mut pending = vec![(path.to_path_buf(), 0)];
    let mut plan = Vec::new();
    let mut preview = DeletePreview {
        path: local::display_path(path)?,
        files: 0,
        directories: 0,
        symlinks: 0,
        paths: Vec::new(),
        truncated: false,
    };
    while let Some((path, depth)) = pending.pop() {
        if let Some(operation) = operation {
            operation.check()?;
        }
        if depth > 64 || plan.len() >= 100_000 {
            return Err(AppError::new(
                "editor_delete_budget",
                "删除预览超过 64 层或 100,000 项预算。",
            ));
        }
        let metadata = fs::symlink_metadata(&path).map_err(local::io_error)?;
        let directory = metadata.is_dir() && !metadata.file_type().is_symlink();
        if directory {
            preview.directories += 1;
            for child in fs::read_dir(&path).map_err(local::io_error)? {
                pending.push((child.map_err(local::io_error)?.path(), depth + 1));
                if pending.len() + plan.len() > 100_000 {
                    return Err(AppError::new(
                        "editor_delete_budget",
                        "删除预览超过 100,000 项预算。",
                    ));
                }
            }
        } else if metadata.file_type().is_symlink() {
            preview.symlinks += 1;
        } else {
            preview.files += 1;
        }
        if preview.paths.len() < 100 {
            preview.paths.push(local::display_path(&path)?);
        } else {
            preview.truncated = true;
        }
        plan.push(DeleteEntry { path, directory });
    }
    Ok((plan, preview))
}
pub fn preview_local(path: &Path) -> AppResult<DeletePreview> {
    collect_delete(path, None).map(|(_, preview)| preview)
}
pub fn delete_local(path: &Path, operation: &FileOperation) -> AppResult<()> {
    let (plan, _) = collect_delete(path, Some(operation))?;
    for entry in plan.into_iter().rev() {
        operation.check()?;
        let metadata = fs::symlink_metadata(&entry.path).map_err(local::io_error)?;
        if entry.directory != (metadata.is_dir() && !metadata.file_type().is_symlink()) {
            return Err(local::conflict());
        }
        if entry.directory {
            fs::remove_dir(&entry.path)
        } else {
            fs::remove_file(&entry.path)
        }
        .map_err(local::io_error)?;
    }
    Ok(())
}
pub fn local_destination(source: &Path, target_directory: &Path) -> AppResult<PathBuf> {
    let metadata = fs::symlink_metadata(target_directory).map_err(local::io_error)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(AppError::new("editor_destination", "目标必须是普通目录。"));
    }
    let target = fs::canonicalize(target_directory).map_err(local::io_error)?;
    let source = local::canonical_target(source)?;
    let name = source.file_name().ok_or_else(unavailable)?;
    let destination = target.join(name);
    if destination == source || target.starts_with(&source) {
        return Err(AppError::new(
            "editor_move_descendant",
            "不能移动或复制到自身或其子目录。",
        ));
    }
    require_absent(&destination)?;
    Ok(destination)
}
fn require_absent(path: &Path) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(local::io_error(error)),
        Ok(_) => Err(AppError::new(
            "editor_exists",
            "目标已存在同名项目；不会自动覆盖。",
        )),
    }
}
#[cfg(target_os = "macos")]
pub fn rename_exclusive(source: &Path, destination: &Path) -> AppResult<()> {
    use std::os::unix::ffi::OsStrExt;
    let source =
        std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|_| unavailable())?;
    let destination =
        std::ffi::CString::new(destination.as_os_str().as_bytes()).map_err(|_| unavailable())?;
    // SAFETY: both C strings remain alive and are NUL-terminated; RENAME_EXCL refuses replacement.
    if unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(local::io_error(std::io::Error::last_os_error()))
    }
}
#[cfg(target_os = "linux")]
pub fn rename_exclusive(source: &Path, destination: &Path) -> AppResult<()> {
    use std::os::unix::ffi::OsStrExt;
    let source =
        std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|_| unavailable())?;
    let destination =
        std::ffi::CString::new(destination.as_os_str().as_bytes()).map_err(|_| unavailable())?;
    // SAFETY: valid C strings with directory-fd-independent absolute paths.
    if unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(local::io_error(std::io::Error::last_os_error()))
    }
}
#[cfg(windows)]
pub fn rename_exclusive(source: &Path, destination: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: live, NUL-terminated wide strings; flags=0 never replaces an existing destination.
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } != 0 {
        Ok(())
    } else {
        Err(local::io_error(std::io::Error::last_os_error()))
    }
}
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn rename_exclusive(_: &Path, _: &Path) -> AppResult<()> {
    Err(AppError::new(
        "editor_move_platform",
        "当前平台没有安全的不覆盖移动接口。",
    ))
}

pub fn copy_local(source: &Path, destination: &Path, operation: &FileOperation) -> AppResult<()> {
    require_absent(destination)?;
    let parent = destination.parent().ok_or_else(unavailable)?;
    let temp = tempfile::Builder::new()
        .prefix(".duo-ssh-copy-")
        .tempdir_in(parent)
        .map_err(local::io_error)?;
    let staged = temp.path().join("payload");
    let mut pending = vec![(source.to_path_buf(), staged.clone(), 0)];
    let mut count = 0;
    let mut seen = HashSet::new();
    let result = (|| {
        while let Some((source, destination, depth)) = pending.pop() {
            operation.check()?;
            count += 1;
            if depth > 64 || count > 100_000 || !seen.insert(source.clone()) {
                return Err(AppError::new(
                    "editor_copy_budget",
                    "复制超过目录深度或项目预算。",
                ));
            }
            let metadata = fs::symlink_metadata(&source).map_err(local::io_error)?;
            if metadata.file_type().is_symlink() {
                return Err(AppError::new(
                    "editor_copy_symlink",
                    "复制不跟随符号链接，请选择真实来源。",
                ));
            }
            if metadata.is_dir() {
                fs::create_dir(&destination).map_err(local::io_error)?;
                for child in fs::read_dir(&source).map_err(local::io_error)? {
                    let child = child.map_err(local::io_error)?;
                    pending.push((child.path(), destination.join(child.file_name()), depth + 1));
                    if pending.len() + count > 100_000 {
                        return Err(AppError::new("editor_copy_budget", "复制超过项目预算。"));
                    }
                }
            } else if metadata.is_file() {
                let mut input = fs::File::open(&source).map_err(local::io_error)?;
                let mut output = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&destination)
                    .map_err(local::io_error)?;
                let mut buffer = [0u8; 64 * 1024];
                loop {
                    operation.check()?;
                    let size = input.read(&mut buffer).map_err(local::io_error)?;
                    if size == 0 {
                        break;
                    }
                    output.write_all(&buffer[..size]).map_err(local::io_error)?;
                }
                output.sync_all().map_err(local::io_error)?;
                fs::set_permissions(&destination, metadata.permissions())
                    .map_err(local::io_error)?;
            } else {
                return Err(AppError::new(
                    "editor_copy_regular",
                    "只能复制普通文件或目录。",
                ));
            }
        }
        operation.check()?;
        rename_exclusive(&staged, destination)
    })();
    let cleanup_path = temp.path().to_path_buf();
    match (result, temp.close()) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (result, Err(_)) => {
            let mut error = result.err().unwrap_or_else(|| {
                AppError::new("editor_copy_cleanup", "复制已完成，但临时目录未能清理。")
            });
            error
                .message
                .push_str(" 临时复制目录未能清理，请检查权限后处理。");
            error.details =
                Some(serde_json::json!({ "cleanupPath": local::display_path(&cleanup_path)? }));
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::workspaces::{EditorManager, FileSource};
    fn operation(root: &Path) -> (EditorManager, FileOperation) {
        let manager = EditorManager::default();
        let scope = manager
            .open(
                "main",
                FileSource::Local,
                Some(local::display_path(root).unwrap()),
                None,
                None,
            )
            .unwrap();
        let id = manager
            .file_operations
            .start(manager.require("main", &scope.id).unwrap())
            .unwrap();
        let operation = manager
            .file_operations
            .require("main", &scope.id, &id)
            .unwrap();
        assert!(
            manager
                .file_operations
                .require("other", &scope.id, &id)
                .is_err()
        );
        (manager, operation)
    }
    #[test]
    fn exclusive_move_and_copy_never_replace_an_existing_destination() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        fs::write(&source, "source").unwrap();
        fs::write(&destination, "existing").unwrap();
        assert!(rename_exclusive(&source, &destination).is_err());
        assert_eq!(fs::read_to_string(&destination).unwrap(), "existing");
        let (_, operation) = operation(root.path());
        assert!(copy_local(&source, &destination, &operation).is_err());
        fs::remove_file(&destination).unwrap();
        copy_local(&source, &destination, &operation).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), "source");
        assert!(source.exists());
        let moved = root.path().join("moved");
        rename_exclusive(&destination, &moved).unwrap();
        assert!(!destination.exists());
        assert!(moved.exists());
    }
    #[test]
    fn root_home_descendant_and_revoked_operations_are_protected() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let home = root.join("home");
        fs::create_dir(&home).unwrap();
        let root_display = local::display_path(&root).unwrap();
        assert!(protect_local(&root, Some(&root_display), &home).is_err());
        assert!(protect_local(&home, None, &home).is_err());
        let child = root.join("child");
        fs::create_dir(&child).unwrap();
        let nested = child.join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(local_destination(&child, &nested).is_err());
        let (manager, operation) = operation(&root);
        manager.close_owner("main").unwrap();
        assert!(operation.check().is_err());
    }
    #[test]
    fn cancelled_deletion_keeps_all_files_and_preview_counts_descendants() {
        let directory = tempfile::tempdir().unwrap();
        let child = directory.path().join("child");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("a"), "keep").unwrap();
        let preview = preview_local(&child).unwrap();
        assert_eq!(preview.files, 1);
        assert_eq!(preview.directories, 1);
        let (_, operation) = operation(directory.path());
        operation.cancel.cancel();
        assert!(delete_local(&child, &operation).is_err());
        assert!(child.join("a").exists());
    }
    #[cfg(unix)]
    #[test]
    fn copy_rejects_links_and_delete_unlinks_without_touching_the_target() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("outside");
        fs::write(&target, "keep").unwrap();
        let link = directory.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let (_, operation) = operation(directory.path());
        let copy = directory.path().join("copy");
        assert!(copy_local(&link, &copy, &operation).is_err());
        assert!(!copy.exists());
        assert!(fs::read_dir(directory.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".duo-ssh-copy-")
        }));
        let preview = preview_local(&link).unwrap();
        assert_eq!(preview.symlinks, 1);
        delete_local(&link, &operation).unwrap();
        assert_eq!(fs::read_to_string(target).unwrap(), "keep");
    }
}
