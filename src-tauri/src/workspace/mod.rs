use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::{
    error::{AppError, AppResult},
    models::workspace::{
        DetachedSftpWorkspace, DetachedTerminalWorkspace, DetachedWorkspace, DetachedWorkspaceKind,
    },
};

pub const DETACHED_WORKSPACE_CLOSED_EVENT: &str = "workspace://detached-window-closed";
pub const DETACHED_WORKSPACE_UPDATED_EVENT: &str = "workspace://detached-window-updated";

#[derive(Clone, Default)]
pub struct DetachedWorkspaceManager {
    workspaces: Arc<Mutex<HashMap<String, DetachedWorkspace>>>,
}

impl DetachedWorkspaceManager {
    pub fn list(&self) -> AppResult<Vec<DetachedWorkspace>> {
        let mut workspaces = self
            .workspaces
            .lock()
            .map_err(|error| AppError::new("workspace_lock_error", error.to_string()))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        workspaces.sort_by(|left, right| left.label.cmp(&right.label));
        Ok(workspaces)
    }

    pub fn get(&self, label: &str) -> AppResult<Option<DetachedWorkspace>> {
        Ok(self
            .workspaces
            .lock()
            .map_err(|error| AppError::new("workspace_lock_error", error.to_string()))?
            .get(label)
            .cloned())
    }

    pub fn open_terminal(
        &self,
        app_handle: &AppHandle,
        parent_label: String,
        title: String,
        terminal: DetachedTerminalWorkspace,
    ) -> AppResult<DetachedWorkspace> {
        let label = format!("detached-terminal-{}", terminal.tab_session_id);
        let workspace = DetachedWorkspace {
            label: label.clone(),
            parent_label,
            kind: DetachedWorkspaceKind::Terminal,
            title,
            terminal: Some(terminal),
            sftp: None,
        };
        self.open(app_handle, workspace)
    }

    pub fn open_sftp(
        &self,
        app_handle: &AppHandle,
        parent_label: String,
        title: String,
        profile_id: String,
    ) -> AppResult<DetachedWorkspace> {
        let label = format!("detached-sftp-{profile_id}");
        let workspace = DetachedWorkspace {
            label: label.clone(),
            parent_label,
            kind: DetachedWorkspaceKind::Sftp,
            title,
            terminal: None,
            sftp: Some(DetachedSftpWorkspace { profile_id }),
        };
        self.open(app_handle, workspace)
    }

    pub fn update_terminal(
        &self,
        app_handle: &AppHandle,
        label: &str,
        terminal: DetachedTerminalWorkspace,
    ) -> AppResult<()> {
        let workspace = {
            let mut workspaces = self
                .workspaces
                .lock()
                .map_err(|error| AppError::new("workspace_lock_error", error.to_string()))?;
            let workspace = workspaces.get_mut(label).ok_or_else(|| {
                AppError::new("detached_workspace_not_found", "独立窗口已关闭或不再可用。")
            })?;
            if !matches!(workspace.kind, DetachedWorkspaceKind::Terminal) {
                return Err(AppError::new(
                    "detached_workspace_kind_error",
                    "这不是终端独立窗口。",
                ));
            }
            workspace.terminal = Some(terminal);
            workspace.clone()
        };
        let parent_label = workspace.parent_label.clone();
        let _ = app_handle.emit_to(parent_label, DETACHED_WORKSPACE_UPDATED_EVENT, workspace);
        Ok(())
    }

    /// Remove a workspace without restoring it. Used only when its tab itself
    /// is intentionally closed from the detached window.
    pub fn discard(&self, label: &str) -> AppResult<()> {
        self.take(label).map(|_| ())
    }

    fn open(
        &self,
        app_handle: &AppHandle,
        workspace: DetachedWorkspace,
    ) -> AppResult<DetachedWorkspace> {
        if let Some(window) = app_handle.get_webview_window(&workspace.label) {
            window
                .set_focus()
                .map_err(|error| AppError::new("detached_window_focus_error", error.to_string()))?;
            return Ok(workspace);
        }

        {
            let mut workspaces = self
                .workspaces
                .lock()
                .map_err(|error| AppError::new("workspace_lock_error", error.to_string()))?;
            workspaces.insert(workspace.label.clone(), workspace.clone());
        }

        let manager = self.clone();
        let label = workspace.label.clone();
        let event_app_handle = app_handle.clone();
        let build_result = WebviewWindowBuilder::new(
            app_handle,
            &workspace.label,
            WebviewUrl::App("index.html".into()),
        )
        .title(format!("{} · Duo SSH", workspace.title))
        .inner_size(1080.0, 720.0)
        .min_inner_size(640.0, 460.0)
        .decorations(false)
        .build();

        let window = match build_result {
            Ok(window) => window,
            Err(error) => {
                let _ = self.take(&workspace.label);
                return Err(AppError::new(
                    "detached_window_open_error",
                    error.to_string(),
                ));
            }
        };
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed)
                && let Ok(Some(closed)) = manager.take(&label)
            {
                let parent_label = closed.parent_label.clone();
                let _ =
                    event_app_handle.emit_to(parent_label, DETACHED_WORKSPACE_CLOSED_EVENT, closed);
            }
        });
        Ok(workspace)
    }

    fn take(&self, label: &str) -> AppResult<Option<DetachedWorkspace>> {
        Ok(self
            .workspaces
            .lock()
            .map_err(|error| AppError::new("workspace_lock_error", error.to_string()))?
            .remove(label))
    }
}
