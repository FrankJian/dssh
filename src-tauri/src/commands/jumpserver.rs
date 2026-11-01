use crate::{
    app::AppState,
    browser,
    error::{AppError, AppResult},
    models::{
        jumpserver::*,
        terminal::{TerminalSession, TerminalSize},
    },
};
use tauri::{AppHandle, Emitter, Manager, Webview};
use zeroize::Zeroizing;
fn trusted(app: &AppHandle, webview: &Webview) -> AppResult<()> {
    browser::trusted(webview)?;
    if app.state::<AppState>().app_lock.status()?.locked {
        return Err(AppError::new("jumpserver_locked", "请先解锁 Duo SSH。"));
    }
    Ok(())
}
#[tauri::command]
pub fn list_jumpserver_profiles(
    app: AppHandle,
    webview: Webview,
) -> AppResult<Vec<JumpServerProfile>> {
    trusted(&app, &webview)?;
    app.state::<AppState>().profiles.list_jumpserver_profiles()
}
#[tauri::command]
pub async fn save_jumpserver_profile(
    app: AppHandle,
    webview: Webview,
    request: SaveJumpServerProfile,
) -> AppResult<JumpServerProfile> {
    trusted(&app, &webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        s.jumpserver.save(&s.profiles, request)
    })
    .await
    .map_err(|_| AppError::new("jumpserver_task", "保存 JumpServer 配置失败。"))?
}
#[tauri::command]
pub async fn delete_jumpserver_profile(
    app: AppHandle,
    webview: Webview,
    id: String,
) -> AppResult<()> {
    trusted(&app, &webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let s = app.state::<AppState>();
        s.jumpserver.delete(&s.profiles, &id)
    })
    .await
    .map_err(|_| AppError::new("jumpserver_task", "删除 JumpServer 配置失败。"))?
}
#[tauri::command]
pub async fn jumpserver_login(
    app: AppHandle,
    webview: Webview,
    id: String,
    secret: Option<Zeroizing<String>>,
) -> AppResult<JumpServerLoginResult> {
    trusted(&app, &webview)?;
    let s = app.state::<AppState>();
    let result = s
        .jumpserver
        .login(&s.profiles, &id, secret, webview.label())
        .await?;
    if s.app_lock.status()?.locked {
        s.jumpserver.logout(&id)?;
        return Err(AppError::new(
            "jumpserver_locked",
            "应用已锁定，登录已取消。",
        ));
    }
    Ok(result)
}
#[tauri::command]
pub async fn jumpserver_verify_otp(
    app: AppHandle,
    webview: Webview,
    id: String,
    challenge_id: String,
    code: Zeroizing<String>,
) -> AppResult<JumpServerLoginResult> {
    trusted(&app, &webview)?;
    let state = app.state::<AppState>();
    let result = state
        .jumpserver
        .verify_otp(&id, &challenge_id, webview.label(), code)
        .await?;
    if state.app_lock.status()?.locked {
        state.jumpserver.logout(&id)?;
        return Err(AppError::new(
            "jumpserver_locked",
            "应用已锁定，登录已取消。",
        ));
    }
    Ok(result)
}
#[tauri::command]
pub fn jumpserver_cancel_login(
    app: AppHandle,
    webview: Webview,
    id: String,
    challenge_id: String,
) -> AppResult<()> {
    browser::trusted(&webview)?;
    app.state::<AppState>()
        .jumpserver
        .cancel_password_login(&id, &challenge_id, webview.label())
}
#[tauri::command]
pub fn jumpserver_open_ssh_gateway(
    app: AppHandle,
    webview: Webview,
    id: String,
    size: TerminalSize,
) -> AppResult<TerminalSession> {
    trusted(&app, &webview)?;
    let state = app.state::<AppState>();
    let (profile, _) = state.profiles.get_jumpserver_profile(&id)?;
    let ssh_id = profile.ssh_profile_id.ok_or_else(|| {
        AppError::new(
            "jumpserver_ssh_missing",
            "请先在编辑连接中关联现有 SSH 配置。",
        )
    })?;
    let ssh = state
        .profiles
        .get_profile(&ssh_id)?
        .ok_or_else(|| AppError::new("profile_not_found", "关联的 SSH 连接已不存在。"))?;
    state.sessions.start_session(app.clone(), ssh, size)
}
#[tauri::command]
pub fn jumpserver_identity(
    app: AppHandle,
    webview: Webview,
    id: String,
) -> AppResult<Option<JumpServerIdentity>> {
    trusted(&app, &webview)?;
    app.state::<AppState>().jumpserver.identity(&id)
}
#[tauri::command]
pub async fn jumpserver_list_assets(
    app: AppHandle,
    webview: Webview,
    query: JumpServerQuery,
) -> AppResult<JumpServerPage<JumpServerAsset>> {
    trusted(&app, &webview)?;
    app.state::<AppState>().jumpserver.assets(query).await
}
#[tauri::command]
pub async fn jumpserver_list_nodes(
    app: AppHandle,
    webview: Webview,
    id: String,
    generation: String,
    offset: u32,
) -> AppResult<JumpServerPage<JumpServerNode>> {
    trusted(&app, &webview)?;
    app.state::<AppState>()
        .jumpserver
        .nodes(&id, &generation, offset)
        .await
}
#[tauri::command]
pub async fn jumpserver_list_accounts(
    app: AppHandle,
    webview: Webview,
    id: String,
    generation: String,
    asset_id: String,
) -> AppResult<Vec<JumpServerAccount>> {
    trusted(&app, &webview)?;
    app.state::<AppState>()
        .jumpserver
        .accounts(&id, &generation, &asset_id)
        .await
}
#[tauri::command]
pub fn jumpserver_open_terminal(
    app: AppHandle,
    webview: Webview,
    target: JumpServerTarget,
    size: TerminalSize,
) -> AppResult<TerminalSession> {
    trusted(&app, &webview)?;
    let s = app.state::<AppState>();
    let profile = s.jumpserver.register_target(target)?;
    s.sessions.start_session(app.clone(), profile, size)
}
#[tauri::command]
pub async fn jumpserver_logout(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    let s = app.state::<AppState>();
    let ids = s.jumpserver.logout(&id)?;
    // Attempt every close even if one worker needs more time. Keep the IDs for
    // a retry until all workers acknowledge teardown.
    let mut failure = None;
    for session in s.sessions.list_sessions()? {
        if ids.contains(&session.profile_id)
            && let Err(error) = s.sessions.close_session(&session.id).await
        {
            failure.get_or_insert(error);
        }
    }
    if let Some(error) = failure {
        return Err(error);
    }
    s.jumpserver.forget_targets(&ids)?;
    let _ = app.emit("jumpserver://targets-closed", &ids);
    let _ = app.emit("jumpserver://logout", &id);
    Ok(())
}
