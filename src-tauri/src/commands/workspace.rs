use tauri::{AppHandle, Emitter, State, Webview};

use crate::{
    app::AppState,
    error::AppResult,
    models::workspace::{
        DetachedWorkbench, DetachedWorkspace, OpenDetachedSftpRequest, OpenDetachedTerminalRequest,
        UpdateDetachedWorkspaceRequest,
    },
};

#[tauri::command]
pub fn list_detached_workspaces(state: State<'_, AppState>) -> AppResult<Vec<DetachedWorkspace>> {
    state.detached_workspaces.list()
}

#[tauri::command]
pub fn get_detached_workspace(
    state: State<'_, AppState>,
    label: String,
) -> AppResult<Option<DetachedWorkspace>> {
    state.detached_workspaces.get(&label)
}

#[tauri::command]
pub async fn open_detached_terminal_workspace(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: OpenDetachedTerminalRequest,
    webview: Webview,
) -> AppResult<DetachedWorkspace> {
    crate::browser::trusted(&webview)?;
    state.detached_workspaces.validate_output_source(
        webview.label(),
        &request.terminal.session_ids,
        &request.command_outputs,
    )?;
    state.detached_workspaces.open_terminal(
        &app_handle,
        request.parent_label,
        request.title,
        request.terminal,
        request.command_outputs,
    )
}

#[tauri::command]
pub async fn open_detached_sftp_workspace(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: OpenDetachedSftpRequest,
) -> AppResult<DetachedWorkspace> {
    state.detached_workspaces.open_sftp(
        &app_handle,
        request.parent_label,
        request.title,
        request.sftp,
    )
}

#[tauri::command]
pub fn update_detached_terminal_workspace(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: UpdateDetachedWorkspaceRequest,
) -> AppResult<()> {
    state
        .detached_workspaces
        .update_terminal(&app_handle, &request.label, request.terminal)
}

#[tauri::command]
pub fn discard_detached_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    webview: Webview,
) -> AppResult<()> {
    crate::browser::trusted(&webview)?;
    let label = webview.label();
    if let Some(mut workspace) = state.detached_workspaces.get(label)? {
        state.detached_workspaces.discard(label)?;
        workspace.terminal = None;
        workspace.sftp = None;
        workspace.workbench = Some(DetachedWorkbench::default());
        let _ = app.emit(crate::workspace::DETACHED_WORKSPACE_CLOSED_EVENT, workspace);
    }
    Ok(())
}

#[tauri::command]
pub fn update_detached_workbench(
    app: AppHandle,
    state: State<'_, AppState>,
    webview: Webview,
    workbench: DetachedWorkbench,
) -> AppResult<()> {
    crate::browser::trusted(&webview)?;
    if workbench.editor_workspaces.len() > 16 {
        return Err(crate::error::AppError::new(
            "editor_reference",
            "编辑器工作区过多。",
        ));
    }
    for reference in &workbench.editor_workspaces {
        reference.validate()?;
    }
    state
        .detached_workspaces
        .update_workbench(&app, webview.label(), workbench)
}

#[tauri::command]
pub fn take_terminal_command_outputs(
    state: State<'_, AppState>,
    webview: Webview,
) -> AppResult<crate::models::workspace::CommandOutputHandoff> {
    crate::browser::trusted(&webview)?;
    state
        .detached_workspaces
        .take_command_outputs(webview.label())
}
