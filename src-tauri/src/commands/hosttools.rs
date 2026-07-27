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
    hosttools::snapshot(profile, tool, state.host_keys.clone()).await
}
