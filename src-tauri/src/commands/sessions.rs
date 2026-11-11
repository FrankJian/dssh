use tauri::{AppHandle, State, Webview};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::{
        ssh_profile::SshProfile,
        terminal::{
            ResizeSshSessionRequest, SessionStatus, StartLocalSessionRequest,
            StartSshSessionRequest, TerminalSession, TerminalSessionKind, TerminalSize,
            WriteSshSessionRequest,
        },
    },
};

#[tauri::command]
pub fn list_ssh_sessions(state: State<'_, AppState>) -> AppResult<Vec<TerminalSession>> {
    state.sessions.list_sessions()
}

/// Reads retained scrollback for a live terminal. This is used when a tab is
/// attached to a different Tauri webview so its new renderer can paint the
/// existing terminal contents before receiving future output events.
#[tauri::command]
pub fn read_ssh_session_output(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<String> {
    state.sessions.read_session_output(&session_id)
}

#[tauri::command]
pub fn start_ssh_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: StartSshSessionRequest,
    webview: Webview,
) -> AppResult<TerminalSession> {
    let profile = resolve_ssh_profile(&state, &webview, &request.profile_id)?;
    state
        .sessions
        .start_session(app_handle, profile, request.size)
}

fn resolve_ssh_profile(
    state: &AppState,
    webview: &Webview,
    profile_id: &str,
) -> AppResult<SshProfile> {
    if crate::jumpserver::is_target(profile_id) {
        crate::browser::trusted(webview)?;
        if state.app_lock.status()?.locked {
            return Err(AppError::new("jumpserver_locked", "请先解锁 Duo SSH。"));
        }
        return state.jumpserver.source(profile_id);
    }
    state.profiles.get_profile(profile_id)?.ok_or_else(|| {
        AppError::new(
            "profile_not_found",
            format!("SSH profile '{profile_id}' does not exist."),
        )
    })
}

#[tauri::command]
pub fn start_local_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: StartLocalSessionRequest,
) -> AppResult<TerminalSession> {
    state.sessions.start_local_session(app_handle, request.size)
}

#[tauri::command]
pub fn write_ssh_session(
    state: State<'_, AppState>,
    request: WriteSshSessionRequest,
) -> AppResult<()> {
    state
        .sessions
        .write_session(&request.session_id, request.data)
}

#[tauri::command]
pub fn respond_zmodem_prompt(
    state: State<'_, AppState>,
    session_id: String,
    detection_id: String,
    paths: Option<Vec<String>>,
) -> AppResult<()> {
    state
        .sessions
        .respond_zmodem_prompt(&session_id, detection_id, paths)
}

#[tauri::command]
pub fn cancel_zmodem_transfer(
    state: State<'_, AppState>,
    session_id: String,
    detection_id: String,
) -> AppResult<()> {
    state
        .sessions
        .cancel_zmodem_transfer(&session_id, detection_id)
}

#[tauri::command]
pub fn respond_zmodem_conflict(
    state: State<'_, AppState>,
    session_id: String,
    detection_id: String,
    overwrite: bool,
) -> AppResult<()> {
    state
        .sessions
        .respond_zmodem_conflict(&session_id, detection_id, overwrite)
}

#[tauri::command]
pub fn resize_ssh_session(
    state: State<'_, AppState>,
    request: ResizeSshSessionRequest,
) -> AppResult<()> {
    state
        .sessions
        .resize_session(&request.session_id, request.size)
}

#[tauri::command]
pub async fn close_ssh_session(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    // Tear down any port forwards bound to this session before closing the
    // shell so tunnels never outlive the SSH connection that spawned them.
    state.forwards.stop_session(&session_id).await;
    state.sessions.close_session(&session_id).await
}

#[tauri::command]
pub async fn reconnect_ssh_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    webview: Webview,
    session_id: String,
    size: TerminalSize,
) -> AppResult<()> {
    let session = state.sessions.reconnect_target(&session_id)?;
    let profile = match session.kind {
        TerminalSessionKind::Local => None,
        TerminalSessionKind::Ssh => {
            Some(resolve_ssh_profile(&state, &webview, &session.profile_id)?)
        }
    };
    if matches!(session.status, SessionStatus::Connected) {
        state.forwards.stop_session(&session_id).await;
    }
    state
        .sessions
        .reconnect_session(app_handle, &session_id, profile, size)
        .await
}

#[tauri::command]
pub fn cancel_reconnect(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.sessions.cancel_reconnect(&session_id)
}

/// Answer a host-key trust prompt raised during an SSH connection.
#[tauri::command]
pub fn respond_host_key_prompt(state: State<'_, AppState>, prompt_id: String, accept: bool) {
    state.host_keys.respond(&prompt_id, accept);
}

/// Answer or cancel a keyboard-interactive SSH authentication challenge.
#[tauri::command]
pub fn respond_ssh_auth_prompt(
    state: State<'_, AppState>,
    prompt_id: String,
    responses: Option<Vec<String>>,
) -> AppResult<()> {
    state.ssh_auth_prompts.respond(&prompt_id, responses)
}
