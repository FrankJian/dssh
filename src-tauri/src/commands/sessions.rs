use tauri::{AppHandle, State};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::terminal::{
        ResizeSshSessionRequest, StartLocalSessionRequest, StartSshSessionRequest, TerminalSession,
        WriteSshSessionRequest,
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
) -> AppResult<TerminalSession> {
    let profile = state
        .profiles
        .get_profile(&request.profile_id)?
        .ok_or_else(|| {
            AppError::new(
                "profile_not_found",
                format!("SSH profile '{}' does not exist.", request.profile_id),
            )
        })?;

    state
        .sessions
        .start_session(app_handle, profile, request.size)
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
    state.sessions.close_session(&session_id)
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
