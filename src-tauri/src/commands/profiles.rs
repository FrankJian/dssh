use tauri::State;

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::ssh_profile::{
        CreateSshProfileRequest, SaveSshCredentialRequest, SshCredential, SshProfile,
        UpdateSshProfileRequest,
    },
};

fn check_profile_access(state: &AppState, webview: &tauri::Webview) -> AppResult<()> {
    crate::browser::trusted(webview)?;
    if state.app_lock.status()?.locked {
        return Err(AppError::new("app_locked", "请先解锁 Duo SSH。"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_ssh_credentials(
    state: State<'_, AppState>,
    webview: tauri::Webview,
) -> AppResult<Vec<SshCredential>> {
    check_profile_access(&state, &webview)?;
    state.profiles.list_ssh_credentials()
}

#[tauri::command]
pub fn save_ssh_credential(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    id: Option<String>,
    request: SaveSshCredentialRequest,
) -> AppResult<SshCredential> {
    check_profile_access(&state, &webview)?;
    state.profiles.save_ssh_credential(id.as_deref(), request)
}

#[tauri::command]
pub fn delete_ssh_credential(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    id: String,
) -> AppResult<()> {
    check_profile_access(&state, &webview)?;
    state.profiles.delete_ssh_credential(&id)
}

#[tauri::command]
pub fn list_ssh_profiles(state: State<'_, AppState>) -> AppResult<Vec<SshProfile>> {
    state.profiles.list_profiles()
}

#[tauri::command]
pub fn create_ssh_profile(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    request: CreateSshProfileRequest,
) -> AppResult<SshProfile> {
    check_profile_access(&state, &webview)?;
    state.profiles.create_profile(request)
}

#[tauri::command]
pub fn clone_ssh_profile(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    source_id: String,
    request: CreateSshProfileRequest,
) -> AppResult<SshProfile> {
    check_profile_access(&state, &webview)?;
    state.profiles.clone_profile(&source_id, request)
}

#[tauri::command]
pub fn update_ssh_profile(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    request: UpdateSshProfileRequest,
) -> AppResult<SshProfile> {
    check_profile_access(&state, &webview)?;
    state.profiles.update_profile(request)
}

#[tauri::command]
pub fn delete_ssh_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.profiles.delete_profile(&id)
}

#[tauri::command]
pub fn rename_ssh_tag(
    state: State<'_, AppState>,
    old_tag: String,
    new_tag: String,
) -> AppResult<Vec<SshProfile>> {
    state.profiles.rename_ssh_tag(&old_tag, &new_tag)?;
    state.profiles.list_profiles()
}

#[tauri::command]
pub fn set_ssh_profile_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<SshProfile> {
    state.profiles.set_favorite(&id, favorite)
}

#[tauri::command]
pub fn rename_connection_folder(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    old_path: String,
    new_name: String,
) -> AppResult<()> {
    check_profile_access(&state, &webview)?;
    state
        .profiles
        .rename_connection_folder(&old_path, &new_name)
}
