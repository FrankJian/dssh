use tauri::State;

use crate::{
    app::AppState,
    error::AppResult,
    models::app_lock::{AppLockStatus, UpdateAppLockSettingsRequest},
};

#[tauri::command]
pub fn get_app_lock_status(state: State<'_, AppState>) -> AppResult<AppLockStatus> {
    state.app_lock.status()
}

#[tauri::command]
pub fn update_app_lock_settings(
    state: State<'_, AppState>,
    request: UpdateAppLockSettingsRequest,
) -> AppResult<AppLockStatus> {
    state.app_lock.update_settings(request)
}

#[tauri::command]
pub fn lock_app(state: State<'_, AppState>) -> AppResult<AppLockStatus> {
    state.app_lock.lock()
}

#[tauri::command]
pub fn unlock_app(state: State<'_, AppState>, password: String) -> AppResult<AppLockStatus> {
    state.app_lock.unlock(&password)
}

#[tauri::command]
pub fn record_app_activity(state: State<'_, AppState>) -> AppResult<()> {
    state.app_lock.record_activity()
}

#[tauri::command]
pub fn lock_app_if_idle(state: State<'_, AppState>) -> AppResult<AppLockStatus> {
    state.app_lock.lock_if_idle()
}
