use tauri::State;

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    hosttools::{self, HostTool, HostToolsSnapshot},
};

/// Collect a read-only host-tools snapshot for a saved connection. Runs a single
/// whitelisted command over SSH and returns parsed rows plus the raw output.
#[tauri::command]
pub async fn host_tools_snapshot(
    state: State<'_, AppState>,
    profile_id: String,
    tool: HostTool,
) -> AppResult<HostToolsSnapshot> {
    let profile = state
        .profiles
        .get_profile(&profile_id)?
        .ok_or_else(|| AppError::new("profile_not_found", "找不到该连接的配置。"))?;
    hosttools::snapshot(profile, tool, &state.ssh_pool).await
}

/// Resolve the current asset without executing anything on the server.
#[tauri::command]
pub async fn server_status_snapshot_target(
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<crate::models::server_snapshot::ServerSnapshotTarget> {
    state.sessions.snapshot_target(&session_id)
}

/// Fixed read-only probes; JumpServer assets reuse their already-selected PTY.
#[tauri::command]
pub async fn server_status_snapshot(
    state: State<'_, AppState>,
    session_id: String,
    expected_target: Option<String>,
) -> AppResult<crate::models::server_snapshot::ServerSnapshotResult> {
    let target = state.sessions.snapshot_target(&session_id)?;
    if expected_target
        .as_ref()
        .is_some_and(|expected| expected != &target.identity)
    {
        return Err(AppError::new(
            "snapshot_target_changed",
            "目标资产已变化，请关闭报告并重新采集。",
        ));
    }
    if !target.ready {
        return Err(AppError::new(
            "snapshot_terminal_busy",
            target.reason.clone().unwrap_or_default(),
        ));
    }
    let output = if target.source == "terminal" {
        hosttools::terminal_snapshot::snapshot(&state.sessions, &session_id, &target.identity)
            .await?
    } else {
        let profile = state.sessions.snapshot_profile(&session_id)?;
        hosttools::server_snapshot::snapshot(profile, &state.ssh_pool).await?
    };
    Ok(crate::models::server_snapshot::ServerSnapshotResult { output, target })
}

#[tauri::command]
pub async fn cancel_server_status_snapshot(
    state: State<'_, AppState>,
    session_id: String,
    expected_target: String,
) -> AppResult<()> {
    state
        .sessions
        .cancel_terminal_snapshot(&session_id, &expected_target)
}
