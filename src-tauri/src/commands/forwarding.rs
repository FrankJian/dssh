use tauri::State;

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::{
        forwarding::{PortForward, StartPortForwardRequest},
        ssh_profile::SshProfile,
    },
};

fn require_profile(state: &AppState, profile_id: &str) -> AppResult<SshProfile> {
    state.profiles.get_profile(profile_id)?.ok_or_else(|| {
        AppError::new(
            "profile_not_found",
            format!("SSH profile '{profile_id}' does not exist."),
        )
    })
}

#[tauri::command]
pub async fn start_port_forward(
    state: State<'_, AppState>,
    request: StartPortForwardRequest,
) -> AppResult<PortForward> {
    let profile = require_profile(&state, &request.profile_id)?;
    let manager = state.forwards.clone();
    manager.start(&profile, request).await
}

#[tauri::command]
pub async fn stop_port_forward(state: State<'_, AppState>, forward_id: String) -> AppResult<()> {
    state.forwards.stop(&forward_id).await;
    Ok(())
}

#[tauri::command]
pub async fn list_port_forwards(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<Vec<PortForward>> {
    Ok(state.forwards.list(&session_id).await)
}
