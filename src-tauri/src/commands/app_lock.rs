use tauri::State;

use crate::{
    app::AppState,
    error::AppResult,
    models::app_lock::{AppLockStatus, UpdateAppLockSettingsRequest},
};

// Status and activity reads can also wait behind Argon2 while the state
// mutex is held. Keep every lock command away from the window thread; the
// mutation + RDP visibility operation still goes through the existing gate.
#[tauri::command]
pub async fn get_app_lock_status(state: State<'_, AppState>) -> AppResult<AppLockStatus> {
    let owned = state.inner().clone();
    super::blocking(move || owned.app_lock.status()).await
}

#[tauri::command]
pub async fn update_app_lock_settings(
    state: State<'_, AppState>,
    request: UpdateAppLockSettingsRequest,
) -> AppResult<AppLockStatus> {
    let owned = state.inner().clone();
    super::blocking(move || {
        owned
            .rdp
            .update_app_lock(|| owned.app_lock.update_settings(request))
    })
    .await
}

#[tauri::command]
pub async fn lock_app(state: State<'_, AppState>) -> AppResult<AppLockStatus> {
    let owned = state.inner().clone();
    super::blocking(move || owned.rdp.update_app_lock(|| owned.app_lock.lock())).await
}

#[tauri::command]
pub async fn unlock_app(state: State<'_, AppState>, password: String) -> AppResult<AppLockStatus> {
    let owned = state.inner().clone();
    super::blocking(move || {
        owned
            .rdp
            .update_app_lock(|| owned.app_lock.unlock(&password))
    })
    .await
}

#[tauri::command]
pub async fn record_app_activity(state: State<'_, AppState>) -> AppResult<()> {
    let owned = state.inner().clone();
    super::blocking(move || owned.app_lock.record_activity()).await
}

#[tauri::command]
pub async fn lock_app_if_idle(state: State<'_, AppState>) -> AppResult<AppLockStatus> {
    let owned = state.inner().clone();
    super::blocking(move || owned.rdp.update_app_lock(|| owned.app_lock.lock_if_idle())).await
}
