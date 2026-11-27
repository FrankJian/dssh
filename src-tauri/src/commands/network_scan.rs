use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::network_scan::{ScanInterface, ScanRequest, ScanUpdate},
    network_scan::{ScanManager, probe},
};
use tauri::{State, Webview, ipc::Channel};

fn unlocked(caller: &Webview, state: &AppState) -> AppResult<()> {
    crate::browser::trusted(caller)?;
    if state.app_lock.status()?.locked {
        return Err(AppError::new("app_locked", "应用已锁定，请先解锁。"));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_scan_interfaces(
    caller: Webview,
    state: State<'_, AppState>,
) -> AppResult<Vec<ScanInterface>> {
    unlocked(&caller, &state)?;
    probe::interfaces().await
}

#[tauri::command]
pub async fn start_lan_ip_scan(
    caller: Webview,
    state: State<'_, AppState>,
    manager: State<'_, ScanManager>,
    request: ScanRequest,
    progress: Channel<ScanUpdate>,
) -> AppResult<ScanUpdate> {
    unlocked(&caller, &state)?;
    manager.start(caller.label(), request, progress).await
}

#[tauri::command]
pub fn cancel_lan_ip_scan(
    caller: Webview,
    manager: State<'_, ScanManager>,
    scan_id: String,
) -> AppResult<bool> {
    crate::browser::trusted(&caller)?;
    manager.cancel(caller.label(), &scan_id)
}
