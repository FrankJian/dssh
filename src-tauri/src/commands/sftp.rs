use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    sftp::SftpListing,
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
pub async fn sftp_disconnect(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    state.sftp.disconnect(&profile_id).await;
    Ok(())
}
