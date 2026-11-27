use super::editor::{profile, unlocked};
use crate::{
    app::AppState,
    editor::{
        file_operations::{self as files, DeletePreview},
        local,
        workspaces::{FileSource, WorkspaceLease},
    },
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{Manager, State, Webview};
#[derive(Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileAction {
    CreateFile {
        parent_path: String,
        name: String,
    },
    CreateDirectory {
        parent_path: String,
        name: String,
    },
    Rename {
        path: String,
        name: String,
    },
    Move {
        paths: Vec<String>,
        target_directory: String,
    },
    Copy {
        paths: Vec<String>,
        target_directory: String,
    },
    Delete {
        paths: Vec<String>,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMutationRequest {
    workspace_id: String,
    operation_id: String,
    action: FileAction,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMutationResult {
    path: String,
    destination: Option<String>,
    status: &'static str,
    message: Option<String>,
}
fn result(path: String, result: AppResult<Option<String>>) -> FileMutationResult {
    match result {
        Ok(destination) => FileMutationResult {
            path,
            destination,
            status: "success",
            message: None,
        },
        Err(error) => FileMutationResult {
            path,
            destination: None,
            status: if error.code == "editor_operation_cancelled" || error.code == "sftp_cancelled"
            {
                "cancelled"
            } else {
                "failed"
            },
            message: Some(error.message),
        },
    }
}
#[tauri::command]
pub async fn editor_begin_file_operation(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
) -> AppResult<String> {
    unlocked(&caller, &state)?;
    state
        .editor
        .file_operations
        .start(state.editor.require(caller.label(), &workspace_id)?)
}
#[tauri::command]
pub async fn editor_cancel_file_operation(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    operation_id: String,
) -> AppResult<()> {
    crate::browser::trusted(&caller)?;
    let operation =
        state
            .editor
            .file_operations
            .require(caller.label(), &workspace_id, &operation_id)?;
    operation.cancel.cancel();
    state.editor.file_operations.finish(&operation_id);
    Ok(())
}
async fn remote_target(
    state: &AppState,
    lease: &WorkspaceLease,
    path: &str,
) -> AppResult<(crate::models::ssh_profile::SshProfile, String)> {
    let profile = profile(state, lease).await?;
    let session = state.sftp.editor_session(&profile).await?;
    let path = session.canonical_path(path, true).await?;
    let home = state.sftp.home(&profile).await?;
    if path == "/" || path == home || lease.workspace.root_path.as_deref() == Some(path.as_str()) {
        return Err(AppError::new(
            "editor_protected_path",
            "不能操作远程根目录、主目录或当前工作区根目录。",
        ));
    }
    Ok((profile, path))
}
#[tauri::command]
pub async fn editor_delete_preview(
    caller: Webview,
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
) -> AppResult<DeletePreview> {
    unlocked(&caller, &state)?;
    let lease = state.editor.require(caller.label(), &workspace_id)?;
    let preview = match lease.workspace.source {
        FileSource::Local => {
            let root = lease.workspace.root_path.clone();
            let home = super::sftp::local_home_path()?;
            super::blocking(move || {
                let target = files::protect_local(&PathBuf::from(path), root.as_deref(), &home)?;
                files::preview_local(&target)
            })
            .await?
        }
        FileSource::Sftp { .. } => {
            let (profile, path) = remote_target(&state, &lease, &path).await?;
            let value = state.sftp.delete_preview(&profile, &path).await?;
            DeletePreview {
                path: value.path,
                files: value.files,
                directories: value.directories,
                symlinks: value.symlinks,
                paths: value.paths,
                truncated: value.truncated,
            }
        }
    };
    lease.ensure_active()?;
    unlocked(&caller, &state)?;
    Ok(preview)
}
#[tauri::command]
pub async fn editor_mutate_files(
    caller: Webview,
    state: State<'_, AppState>,
    request: FileMutationRequest,
) -> AppResult<Vec<FileMutationResult>> {
    unlocked(&caller, &state)?;
    let operation = state.editor.file_operations.require(
        caller.label(),
        &request.workspace_id,
        &request.operation_id,
    )?;
    operation.check()?;
    let lease = operation.lease.clone();
    let paths = match &request.action {
        FileAction::CreateFile { parent_path, .. }
        | FileAction::CreateDirectory { parent_path, .. } => vec![parent_path.clone()],
        FileAction::Rename { path, .. } => vec![path.clone()],
        FileAction::Move { paths, .. }
        | FileAction::Copy { paths, .. }
        | FileAction::Delete { paths } => paths.clone(),
    };
    if paths.is_empty() || paths.len() > 1000 {
        state.editor.file_operations.finish(&request.operation_id);
        return Err(AppError::new(
            "editor_file_selection",
            "请选择 1–1,000 个文件项目。",
        ));
    }
    let mut results = Vec::new();
    for path in paths {
        if let Err(error) = unlocked(&caller, &state).and_then(|_| operation.check()) {
            results.push(result(path, Err(error)));
            continue;
        }
        let outcome: AppResult<Option<String>> = async {
            match &lease.workspace.source {
                FileSource::Local => {
                    let root = lease.workspace.root_path.clone();
                    let home = super::sftp::local_home_path()?;
                    let action = request.action.clone();
                    let source = path.clone();
                    let operation = operation.clone();
                    let create_directory = matches!(action, FileAction::CreateDirectory { .. });
                    let copying = matches!(action, FileAction::Copy { .. });
                    super::blocking(move || {
                        operation.check()?;
                        match action {
                            FileAction::CreateFile { name, .. }
                            | FileAction::CreateDirectory { name, .. } => {
                                let target = super::sftp::local_child_path(&source, &name)?;
                                if create_directory {
                                    std::fs::create_dir(&target).map_err(local::io_error)?;
                                } else {
                                    std::fs::OpenOptions::new()
                                        .write(true)
                                        .create_new(true)
                                        .open(&target)
                                        .map_err(local::io_error)?;
                                }
                                Ok(Some(local::display_path(&target)?))
                            }
                            FileAction::Rename { name, .. } => {
                                let source = files::protect_local(
                                    &PathBuf::from(source),
                                    root.as_deref(),
                                    &home,
                                )?;
                                let parent = source.parent().ok_or_else(|| {
                                    AppError::new("editor_parent", "文件没有父目录。")
                                })?;
                                let target = super::sftp::local_child_path(
                                    &local::display_path(parent)?,
                                    &name,
                                )?;
                                files::rename_exclusive(&source, &target)?;
                                Ok(Some(local::display_path(&target)?))
                            }
                            FileAction::Move {
                                target_directory, ..
                            }
                            | FileAction::Copy {
                                target_directory, ..
                            } => {
                                let source = files::protect_local(
                                    &PathBuf::from(source),
                                    root.as_deref(),
                                    &home,
                                )?;
                                let target = files::local_destination(
                                    &source,
                                    &PathBuf::from(target_directory),
                                )?;
                                if copying {
                                    files::copy_local(&source, &target, &operation)?;
                                } else {
                                    files::rename_exclusive(&source, &target)?;
                                }
                                Ok(Some(local::display_path(&target)?))
                            }
                            FileAction::Delete { .. } => {
                                let source = files::protect_local(
                                    &PathBuf::from(source),
                                    root.as_deref(),
                                    &home,
                                )?;
                                files::delete_local(&source, &operation)?;
                                Ok(None)
                            }
                        }
                    })
                    .await
                }
                FileSource::Sftp { .. } => {
                    let profile = profile(&state, &lease).await?;
                    match &request.action {
                        FileAction::CreateFile { name, .. } => state
                            .sftp
                            .create_file(&profile, &path, name)
                            .await
                            .map(Some),
                        FileAction::CreateDirectory { name, .. } => {
                            state.sftp.create_dir(&profile, &path, name).await.map(Some)
                        }
                        FileAction::Rename { name, .. } => {
                            let (_, source) = remote_target(&state, &lease, &path).await?;
                            let parent = source
                                .rsplit_once('/')
                                .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
                                .unwrap_or("/");
                            let listing = state.sftp.list(&profile, parent).await?;
                            if listing.entries.iter().any(|item| item.name == name.trim()) {
                                return Err(AppError::new(
                                    "editor_exists",
                                    "目标已存在同名项目；不会自动覆盖。",
                                ));
                            }
                            state.sftp.rename(&profile, &source, name).await.map(Some)
                        }
                        FileAction::Move {
                            target_directory, ..
                        } => {
                            let (_, source) = remote_target(&state, &lease, &path).await?;
                            state
                                .sftp
                                .move_entries(&profile, &[source], target_directory)
                                .await
                                .map(|paths| paths.into_iter().next())
                        }
                        FileAction::Copy {
                            target_directory, ..
                        } => {
                            let (_, source) = remote_target(&state, &lease, &path).await?;
                            let name = source.rsplit('/').next().unwrap_or("");
                            let target =
                                format!("{}/{name}", target_directory.trim_end_matches('/'));
                            let copying = state
                                .sftp
                                .copy_remote(
                                    caller.app_handle(),
                                    &profile,
                                    &source,
                                    &target,
                                    &request.operation_id,
                                )
                                ;
                            tokio::pin!(copying);
                            tokio::select! {
                                result = &mut copying => result?,
                                _ = operation.cancel.cancelled() => { state.sftp.cancel_operation(&request.operation_id).await; copying.await?; }
                            }
                            Ok(Some(target.clone()))
                        }
                        FileAction::Delete { .. } => {
                            let (_, source) = remote_target(&state, &lease, &path).await?;
                            let deleting = state
                                .sftp
                                .delete_recursive(
                                    caller.app_handle(),
                                    &profile,
                                    &source,
                                    &request.operation_id,
                                )
                                ;
                            tokio::pin!(deleting);
                            let value = tokio::select! {
                                biased;
                                result = &mut deleting => result?,
                                _ = operation.cancel.cancelled() => { state.sftp.cancel_operation(&request.operation_id).await; deleting.await? }
                            };
                            if value.cancelled {
                                return Err(AppError::new(
                                    "editor_operation_cancelled",
                                    "删除已停止，部分项目可能已删除。",
                                ));
                            }
                            Ok(None)
                        }
                    }
                }
            }
        }
        .await;
        results.push(result(path, outcome));
    }
    state
        .sftp
        .clear_operation_cancellation(&request.operation_id)
        .await;
    state.editor.file_operations.finish(&request.operation_id);
    Ok(results)
}
