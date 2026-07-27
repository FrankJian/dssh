use tauri::State;

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::ssh_profile::{CreateSshProfileRequest, SshProfile, UpdateSshProfileRequest},
};

#[tauri::command]
pub fn list_ssh_profiles(state: State<'_, AppState>) -> AppResult<Vec<SshProfile>> {
    state.profiles.list_profiles()
}

#[tauri::command]
pub fn create_ssh_profile(
    state: State<'_, AppState>,
    request: CreateSshProfileRequest,
) -> AppResult<SshProfile> {
    state.profiles.create_profile(request)
}

#[tauri::command]
pub fn update_ssh_profile(
    state: State<'_, AppState>,
    request: UpdateSshProfileRequest,
) -> AppResult<SshProfile> {
    state.profiles.update_profile(request)
}

#[tauri::command]
pub fn delete_ssh_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.profiles.delete_profile(&id)
}

#[tauri::command]
pub fn set_ssh_profile_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<SshProfile> {
    state.profiles.set_favorite(&id, favorite)
}

/// Reads the contents of a user-selected private key file so the frontend can
/// store the key material with the profile.
#[tauri::command]
pub fn read_key_file(path: String) -> AppResult<String> {
    std::fs::read_to_string(&path)
        .map_err(|error| AppError::new("key_read_error", error.to_string()))
}
