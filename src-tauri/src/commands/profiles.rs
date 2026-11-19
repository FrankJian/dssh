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
pub async fn list_ssh_credentials(
    state: State<'_, AppState>,
    webview: tauri::Webview,
) -> AppResult<Vec<SshCredential>> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.list_ssh_credentials()).await
}

#[tauri::command]
pub async fn save_ssh_credential(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    id: Option<String>,
    request: SaveSshCredentialRequest,
) -> AppResult<SshCredential> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.save_ssh_credential(id.as_deref(), request)).await
}

#[tauri::command]
pub async fn delete_ssh_credential(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    id: String,
) -> AppResult<()> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.delete_ssh_credential(&id)).await
}

#[tauri::command]
pub async fn list_ssh_profiles(state: State<'_, AppState>) -> AppResult<Vec<SshProfile>> {
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.list_profiles()).await
}

#[tauri::command]
pub async fn create_ssh_profile(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    request: CreateSshProfileRequest,
) -> AppResult<SshProfile> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.create_profile(request)).await
}

#[tauri::command]
pub async fn clone_ssh_profile(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    source_id: String,
    request: CreateSshProfileRequest,
) -> AppResult<SshProfile> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.clone_profile(&source_id, request)).await
}

#[tauri::command]
pub async fn update_ssh_profile(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    request: UpdateSshProfileRequest,
) -> AppResult<SshProfile> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.update_profile(request)).await
}

#[tauri::command]
pub async fn delete_ssh_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.delete_profile(&id)).await
}

#[tauri::command]
pub async fn rename_ssh_tag(
    state: State<'_, AppState>,
    old_tag: String,
    new_tag: String,
) -> AppResult<Vec<SshProfile>> {
    let profiles = state.profiles.clone();
    super::blocking(move || {
        profiles.rename_ssh_tag(&old_tag, &new_tag)?;
        profiles.list_profiles()
    })
    .await
}

#[tauri::command]
pub async fn set_ssh_profile_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<SshProfile> {
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.set_favorite(&id, favorite)).await
}

#[tauri::command]
pub async fn rename_connection_folder(
    state: State<'_, AppState>,
    webview: tauri::Webview,
    old_path: String,
    new_name: String,
) -> AppResult<()> {
    check_profile_access(&state, &webview)?;
    let profiles = state.profiles.clone();
    super::blocking(move || profiles.rename_connection_folder(&old_path, &new_name)).await
}
