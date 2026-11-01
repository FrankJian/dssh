use crate::{
    app::AppState,
    browser,
    error::{AppError, AppResult},
    models::rdp::{RdpEngineStatus, RdpProfile, RdpSession, SaveRdpProfileRequest},
    rdp,
};
use tauri::{AppHandle, Manager, Webview};
use zeroize::Zeroizing;

fn trusted(app: &AppHandle, webview: &Webview) -> AppResult<()> {
    browser::trusted(webview)?;
    if app.state::<AppState>().app_lock.status()?.locked {
        return Err(AppError::new("rdp_locked", "请先解锁 Duo SSH。"));
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_engine_status(app: AppHandle, webview: Webview) -> AppResult<RdpEngineStatus> {
    trusted(&app, &webview)?;
    Ok(rdp::engine_status(&app))
}
#[tauri::command]
pub fn list_rdp_profiles(app: AppHandle, webview: Webview) -> AppResult<Vec<RdpProfile>> {
    trusted(&app, &webview)?;
    app.state::<AppState>().profiles.list_rdp_profiles()
}
#[tauri::command]
pub async fn save_rdp_profile(
    app: AppHandle,
    webview: Webview,
    request: SaveRdpProfileRequest,
) -> AppResult<RdpProfile> {
    trusted(&app, &webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.rdp.save(&state.profiles, request)
    })
    .await
    .map_err(|_| AppError::new("rdp_task", "RDP 保存任务异常。"))?
}
#[tauri::command]
pub async fn delete_rdp_profile(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.rdp.delete(&state.profiles, &id)
    })
    .await
    .map_err(|_| AppError::new("rdp_task", "RDP 删除任务异常。"))?
}
#[tauri::command]
pub fn list_rdp_sessions(app: AppHandle, webview: Webview) -> AppResult<Vec<RdpSession>> {
    trusted(&app, &webview)?;
    Ok(app.state::<AppState>().rdp.list(webview.label()))
}
#[tauri::command]
pub async fn start_rdp_session(
    app: AppHandle,
    webview: Webview,
    profile_id: String,
    password: Option<Zeroizing<String>>,
) -> AppResult<RdpSession> {
    trusted(&app, &webview)?;
    let owner = webview.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<AppState>().rdp.clone();
        manager.start(app, owner, profile_id, password)
    })
    .await
    .map_err(|_| AppError::new("rdp_task", "RDP 启动任务异常。"))?
}
#[tauri::command]
pub fn focus_rdp_session(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    app.state::<AppState>()
        .rdp
        .control(webview.label(), &id, false)
}
#[tauri::command]
pub fn close_rdp_session(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    app.state::<AppState>()
        .rdp
        .control(webview.label(), &id, true)
}
