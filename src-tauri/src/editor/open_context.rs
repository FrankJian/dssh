//! Keep a browser's directory context separate from the file selected for editing.
use std::path::{Path, PathBuf};

use super::{local, workspaces::FileSource};
use crate::error::{AppError, AppResult};

fn invalid_root() -> AppError {
    AppError::new(
        "editor_root_context",
        "所选文件不属于提供的编辑目录，请刷新文件列表后重试。",
    )
}

pub fn remote_target(path: Option<&str>, directory: bool) -> Option<&str> {
    path.or(if directory { Some(".") } else { None })
}

pub fn workspace_paths(
    source: &FileSource,
    path: Option<String>,
    directory: bool,
    context_root: Option<String>,
) -> AppResult<(Option<String>, Option<String>)> {
    if directory {
        if context_root.is_some() {
            return Err(invalid_root());
        }
        return Ok((path, None));
    }
    if let Some(root) = context_root.as_deref() {
        let path = path.as_deref().ok_or_else(invalid_root)?;
        let within = match source {
            FileSource::Local => Path::new(path).starts_with(root),
            FileSource::Sftp { .. } => {
                path.starts_with(&format!("{}/", root.trim_end_matches('/')))
            }
        };
        if !within {
            return Err(invalid_root());
        }
    }
    Ok((context_root, path))
}

pub fn local_paths(
    path: Option<String>,
    directory: bool,
    context_root: Option<String>,
) -> AppResult<(Option<String>, Option<String>)> {
    fn resolve(path: String, directory: bool) -> AppResult<String> {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err(AppError::new("editor_absolute_path", "请选择绝对路径。"));
        }
        let path = std::fs::canonicalize(path).map_err(local::io_error)?;
        let metadata = std::fs::metadata(&path).map_err(local::io_error)?;
        if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
            return Err(AppError::new("editor_path_type", "所选路径类型不正确。"));
        }
        local::display_path(&path)
    }
    let path = path.map(|path| resolve(path, directory)).transpose()?;
    let root = context_root.map(|path| resolve(path, true)).transpose()?;
    workspace_paths(&FileSource::Local, path, directory, root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_remote_restore_is_distinct_from_explicit_home_directory_open() {
        assert_eq!(remote_target(None, false), None);
        assert_eq!(remote_target(None, true), Some("."));
        assert_eq!(
            remote_target(Some("/home/test/file"), false),
            Some("/home/test/file")
        );
        let source = FileSource::Sftp {
            profile_id: "fixture".into(),
        };
        assert_eq!(
            workspace_paths(&source, None, false, None).unwrap(),
            (None, None)
        );
        assert!(workspace_paths(&source, None, false, Some("/home/test".into())).is_err());
    }

    #[test]
    fn local_file_context_preserves_root_and_nested_file_without_changing_single_file_open() {
        let directory = tempfile::tempdir().unwrap();
        let nested = directory.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        let file = nested.join(".settings.txt");
        std::fs::write(&file, b"text").unwrap();
        let path = file.to_string_lossy().into_owned();
        let root = directory.path().to_string_lossy().into_owned();
        let (context, initial) =
            local_paths(Some(path.clone()), false, Some(root.clone())).unwrap();
        assert_eq!(
            context,
            Some(local::display_path(&directory.path().canonicalize().unwrap()).unwrap())
        );
        assert_eq!(
            initial,
            Some(local::display_path(&file.canonicalize().unwrap()).unwrap())
        );
        assert_eq!(local_paths(Some(path), false, None).unwrap().0, None);
        assert!(local_paths(Some(root.clone()), false, Some(root)).is_err());
    }

    #[test]
    fn context_rejects_missing_files_wrong_types_and_sibling_prefixes() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("root");
        std::fs::create_dir(&root).unwrap();
        let outside = directory.path().join("file.txt");
        std::fs::write(&outside, b"text").unwrap();
        assert_eq!(
            local_paths(
                Some(outside.to_string_lossy().into_owned()),
                false,
                Some(root.to_string_lossy().into_owned())
            )
            .unwrap_err()
            .code,
            "editor_root_context"
        );
        assert!(local_paths(None, false, Some(root.to_string_lossy().into_owned())).is_err());
        assert!(
            local_paths(
                Some(root.to_string_lossy().into_owned()),
                true,
                Some(outside.to_string_lossy().into_owned())
            )
            .is_err()
        );
        let source = FileSource::Sftp {
            profile_id: "fixture".into(),
        };
        assert!(
            workspace_paths(
                &source,
                Some("/home/test2/file".into()),
                false,
                Some("/home/test".into())
            )
            .is_err()
        );
        assert!(
            workspace_paths(
                &source,
                Some("/home/test/sub/file".into()),
                false,
                Some("/home/test".into())
            )
            .is_ok()
        );
        assert!(workspace_paths(&source, Some("/file".into()), false, Some("/".into())).is_ok());
        assert!(
            workspace_paths(
                &source,
                Some("/home/Test/file".into()),
                false,
                Some("/home/test".into())
            )
            .is_err()
        );
    }
}
