use std::{path::PathBuf, time::UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    sftp::{
        SftpDeletePreview, SftpDeleteResult, SftpFileInfo, SftpImageFile, SftpListing, SftpTextFile,
    },
};

fn require_profile(state: &AppState, profile_id: &str) -> AppResult<SshProfile> {
    state.profiles.get_profile(profile_id)?.ok_or_else(|| {
        AppError::new(
            "profile_not_found",
            format!("SSH profile '{profile_id}' does not exist."),
        )
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
    size: u64,
    modified: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing {
    path: String,
    entries: Vec<LocalFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRoot {
    path: String,
    label: String,
}

fn local_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("local_file_error", error.to_string())
}

fn local_home_path() -> AppResult<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| AppError::new("local_file_error", "无法确定本机主目录。"))
}

fn local_display_path(path: &std::path::Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc_path) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc_path}");
        }
        if let Some(normal_path) = value.strip_prefix(r"\\?\") {
            return normal_path.to_string();
        }
    }
    value.into_owned()
}

#[tauri::command]
pub async fn sftp_local_home() -> AppResult<String> {
    Ok(local_display_path(&local_home_path()?))
}

#[tauri::command]
pub async fn sftp_local_roots() -> AppResult<Vec<LocalRoot>> {
    let home = local_home_path()?;
    let mut roots = vec![LocalRoot {
        path: local_display_path(&home),
        label: "主目录".to_string(),
    }];

    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let path = format!("{}:\\", char::from(letter));
            if std::fs::metadata(&path).is_ok() {
                roots.push(LocalRoot {
                    label: format!("{} 盘", char::from(letter)),
                    path,
                });
            }
        }
    }

    #[cfg(not(windows))]
    if roots[0].path != "/" {
        roots.push(LocalRoot {
            path: "/".to_string(),
            label: "文件系统".to_string(),
        });
    }

    Ok(roots)
}

#[tauri::command]
pub async fn sftp_local_list(path: String) -> AppResult<LocalListing> {
    let requested = if path.trim().is_empty() {
        local_home_path()?
    } else {
        PathBuf::from(path.trim())
    };
    let canonical = tokio::fs::canonicalize(&requested)
        .await
        .map_err(local_error)?;
    let mut directory = tokio::fs::read_dir(&canonical).await.map_err(local_error)?;
    let mut entries = Vec::new();
    while let Some(entry) = directory.next_entry().await.map_err(local_error)? {
        let path = entry.path();
        let file_type = entry.file_type().await.map_err(local_error)?;
        let metadata = entry.metadata().await.map_err(local_error)?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| i64::try_from(duration.as_secs()).ok());
        entries.push(LocalFileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: local_display_path(&path),
            is_dir: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
            size: metadata.len(),
            modified,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(LocalListing {
        path: local_display_path(&canonical),
        entries,
    })
}

#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, profile_id: String) -> AppResult<String> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.home(&profile).await
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    profile_id: String,
    path: String,
) -> AppResult<SftpListing> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.list(&profile, &path).await
}

#[tauri::command]
pub async fn sftp_read_text(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
) -> AppResult<SftpTextFile> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.read_text(&profile, &remote_path).await
}

#[tauri::command]
pub async fn sftp_write_text(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    content: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.write_text(&profile, &remote_path, &content).await
}

#[tauri::command]
pub async fn sftp_read_image(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
) -> AppResult<SftpImageFile> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.read_image(&profile, &remote_path).await
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    local_path: String,
    operation_id: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .download(&app, &profile, &remote_path, &local_path, &operation_id)
        .await
}

#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    local_path: String,
    operation_id: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .download_dir(&app, &profile, &remote_path, &local_path, &operation_id)
        .await
}

#[tauri::command]
pub async fn sftp_download_tree(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    local_path: String,
    operation_id: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .download_tree(&app, &profile, &remote_path, &local_path, &operation_id)
        .await
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    local_path: String,
    remote_path: String,
    operation_id: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .upload(&app, &profile, &local_path, &remote_path, &operation_id)
        .await
}

#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    local_path: String,
    remote_path: String,
    operation_id: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .upload_dir(&app, &profile, &local_path, &remote_path, &operation_id)
        .await
}

#[tauri::command]
pub async fn sftp_create_dir(
    state: State<'_, AppState>,
    profile_id: String,
    parent_path: String,
    name: String,
) -> AppResult<String> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.create_dir(&profile, &parent_path, &name).await
}

#[tauri::command]
pub async fn sftp_create_file(
    state: State<'_, AppState>,
    profile_id: String,
    parent_path: String,
    name: String,
) -> AppResult<String> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.create_file(&profile, &parent_path, &name).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    new_name: String,
) -> AppResult<String> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.rename(&profile, &remote_path, &new_name).await
}

#[tauri::command]
pub async fn sftp_delete_file(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.delete_file(&profile, &remote_path).await
}

#[tauri::command]
pub async fn sftp_delete_empty_dir(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.delete_empty_dir(&profile, &remote_path).await
}

#[tauri::command]
pub async fn sftp_file_info(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
) -> AppResult<SftpFileInfo> {
    let profile = require_profile(&state, &profile_id)?;
    state.sftp.file_info(&profile, &remote_path).await
}

#[tauri::command]
pub async fn sftp_set_permissions(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    permissions: u32,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    state
        .sftp
        .set_permissions(&profile, &remote_path, permissions)
        .await
}

#[tauri::command]
pub async fn sftp_move_entries(
    state: State<'_, AppState>,
    profile_id: String,
    sources: Vec<String>,
    target_dir: String,
) -> AppResult<Vec<String>> {
    let profile = require_profile(&state, &profile_id)?;
    state
        .sftp
        .move_entries(&profile, &sources, &target_dir)
        .await
}

#[tauri::command]
pub async fn sftp_delete_preview(
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
) -> AppResult<SftpDeletePreview> {
    let profile = require_profile(&state, &profile_id)?;
    state.sftp.delete_preview(&profile, &remote_path).await
}

#[tauri::command]
pub async fn sftp_delete_recursive(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    operation_id: String,
) -> AppResult<SftpDeleteResult> {
    let profile = require_profile(&state, &profile_id)?;
    state
        .sftp
        .delete_recursive(&app, &profile, &remote_path, &operation_id)
        .await
}

#[tauri::command]
pub async fn sftp_cancel_operation(
    state: State<'_, AppState>,
    operation_id: String,
) -> AppResult<()> {
    state.sftp.cancel_operation(&operation_id).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_disconnect(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    state.sftp.disconnect(&profile_id).await;
    Ok(())
}
