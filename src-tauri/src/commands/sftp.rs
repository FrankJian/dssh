use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    sftp::{SftpImageFile, SftpListing, SftpTextFile},
};

fn require_profile(state: &AppState, profile_id: &str) -> AppResult<SshProfile> {
    state.profiles.get_profile(profile_id)?.ok_or_else(|| {
        AppError::new(
            "profile_not_found",
            format!("SSH profile '{profile_id}' does not exist."),
        )
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
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .download(&app, &profile, &remote_path, &local_path)
        .await
}

#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    remote_path: String,
    local_path: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager
        .download_dir(&app, &profile, &remote_path, &local_path)
        .await
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    profile_id: String,
    local_path: String,
    remote_path: String,
) -> AppResult<()> {
    let profile = require_profile(&state, &profile_id)?;
    let manager = state.sftp.clone();
    manager.upload(&profile, &local_path, &remote_path).await
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
pub async fn sftp_disconnect(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    state.sftp.disconnect(&profile_id).await;
    Ok(())
}
