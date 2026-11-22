use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::{
    error::{AppError, AppResult},
    models::workspace::{
        CommandOutputHandoff, DetachedSftpWorkspace, DetachedTerminalWorkspace, DetachedWorkbench,
        DetachedWorkspace, DetachedWorkspaceKind,
    },
};

static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

pub const DETACHED_WORKSPACE_CLOSED_EVENT: &str = "workspace://detached-window-closed";
pub const DETACHED_WORKSPACE_UPDATED_EVENT: &str = "workspace://detached-window-updated";

#[derive(Clone, Default)]
pub struct DetachedWorkspaceManager {
    workspaces: Arc<Mutex<HashMap<String, DetachedWorkspace>>>,
    command_outputs: Arc<Mutex<HashMap<String, CommandOutputHandoff>>>,
}

impl DetachedWorkspaceManager {
    /// Hold ownership stable until a confirmed terminal action has been queued.
    pub fn with_terminal_owner<T>(
        &self,
        source: &str,
        id: &str,
        action: impl FnOnce() -> AppResult<T>,
    ) -> AppResult<T> {
        let workspaces = self.workspaces.lock().map_err(|_| output_handoff_error())?;
        let mut owners = workspaces
            .values()
            .filter(|workspace| {
                workspace
                    .workbench
                    .as_ref()
                    .map(|w| &w.session_ids)
                    .or_else(|| workspace.terminal.as_ref().map(|t| &t.session_ids))
                    .is_some_and(|ids| ids.iter().any(|candidate| candidate == id))
            })
            .map(|workspace| workspace.label.as_str());
        let owner = owners.next().unwrap_or("main");
        if owner != source || owners.next().is_some() {
            return Err(AppError::new(
                "shell_integration_owner",
                "终端归属已变化，请重新确认。",
            ));
        }
        let result = action();
        drop(workspaces);
        result
    }

    pub fn validate_output_source(
        &self,
        source: &str,
        ids: &[String],
        outputs: &CommandOutputHandoff,
    ) -> AppResult<()> {
        let workspaces = self.list()?;
        for id in ids {
            let owner = workspaces
                .iter()
                .find(|workspace| {
                    workspace
                        .workbench
                        .as_ref()
                        .map(|w| &w.session_ids)
                        .or_else(|| workspace.terminal.as_ref().map(|t| &t.session_ids))
                        .is_some_and(|sessions| sessions.contains(id))
                })
                .map_or("main", |workspace| workspace.label.as_str());
            if owner != source {
                return Err(output_handoff_error());
            }
        }
        validate_command_outputs(ids, outputs)
    }

    pub fn take_command_outputs(&self, owner: &str) -> AppResult<CommandOutputHandoff> {
        if self.get(owner)?.is_none() {
            return Err(output_handoff_error());
        }
        Ok(self
            .command_outputs
            .lock()
            .map_err(|_| output_handoff_error())?
            .remove(owner)
            .unwrap_or_default())
    }

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
        command_outputs: CommandOutputHandoff,
    ) -> AppResult<DetachedWorkspace> {
        let label = format!(
            "detached-terminal-{}",
            NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
        );
        let workspace = DetachedWorkspace {
            label: label.clone(),
            parent_label,
            kind: DetachedWorkspaceKind::Terminal,
            title,
            terminal: Some(terminal),
            sftp: None,
            workbench: None,
        };
        self.command_outputs
            .lock()
            .map_err(|_| output_handoff_error())?
            .insert(label, command_outputs);
        self.open(app_handle, workspace)
    }

    pub fn open_sftp(
        &self,
        app_handle: &AppHandle,
        parent_label: String,
        title: String,
        sftp: DetachedSftpWorkspace,
    ) -> AppResult<DetachedWorkspace> {
        let label = format!(
            "detached-sftp-{}",
            NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
        );
        let workspace = DetachedWorkspace {
            label: label.clone(),
            parent_label,
            kind: DetachedWorkspaceKind::Sftp,
            title,
            terminal: None,
            sftp: Some(sftp),
            workbench: None,
        };
        self.open(app_handle, workspace)
    }

    pub fn open_workbench(&self, app: &AppHandle, title: String) -> AppResult<DetachedWorkspace> {
        self.open(
            app,
            DetachedWorkspace {
                label: format!(
                    "detached-workbench-{}",
                    NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed)
                ),
                parent_label: "main".into(),
                kind: DetachedWorkspaceKind::Workbench,
                title,
                terminal: None,
                sftp: None,
                workbench: Some(DetachedWorkbench::default()),
            },
        )
    }

    pub fn update_workbench(
        &self,
        app: &AppHandle,
        label: &str,
        workbench: DetachedWorkbench,
    ) -> AppResult<()> {
        let workspace = {
            let mut items = self
                .workspaces
                .lock()
                .map_err(|e| AppError::new("workspace_lock_error", e.to_string()))?;
            let workspace = items
                .get_mut(label)
                .ok_or_else(|| AppError::new("detached_workspace_not_found", "独立窗口已关闭。"))?;
            workspace.workbench = Some(workbench);
            workspace.clone()
        };
        let _ = app.emit(DETACHED_WORKSPACE_UPDATED_EVENT, workspace);
        Ok(())
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
        if let Some(window) = app_handle.get_window(&workspace.label) {
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
        let window_builder = WebviewWindowBuilder::new(
            app_handle,
            &workspace.label,
            WebviewUrl::App("index.html".into()),
        )
        .title(format!("{} · Duo SSH", workspace.title))
        .inner_size(1080.0, 720.0)
        .min_inner_size(640.0, 460.0)
        .resizable(true);

        // Keep the native macOS window frame available for edge resizing while
        // retaining the custom HTML title bar. Windows and Linux continue to
        // use the borderless title bar; Tauri's runtime resize handler covers
        // those platforms when the window is explicitly marked resizable.
        #[cfg(target_os = "macos")]
        let window_builder = window_builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
        #[cfg(not(target_os = "macos"))]
        let window_builder = window_builder.decorations(false);

        let build_result = window_builder.build();

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
        let _ = app_handle.emit(DETACHED_WORKSPACE_UPDATED_EVENT, &workspace);
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed)
                && let Ok(Some(mut closed)) = manager.take(&label)
            {
                // Windows are independent workbenches; destruction only removes ownership.
                // It never restores their tabs in another window.
                closed.terminal = None;
                closed.sftp = None;
                closed.workbench = Some(DetachedWorkbench::default());
                let _ = event_app_handle.emit(DETACHED_WORKSPACE_CLOSED_EVENT, closed);
            }
        });
        Ok(workspace)
    }

    fn take(&self, label: &str) -> AppResult<Option<DetachedWorkspace>> {
        self.command_outputs
            .lock()
            .map_err(|_| output_handoff_error())?
            .remove(label);
        Ok(self
            .workspaces
            .lock()
            .map_err(|error| AppError::new("workspace_lock_error", error.to_string()))?
            .remove(label))
    }
}

fn output_handoff_error() -> AppError {
    AppError::new("terminal_output_handoff", "命令输出交接目标或记录无效。")
}

fn validate_command_outputs(ids: &[String], outputs: &CommandOutputHandoff) -> AppResult<()> {
    for (id, records) in outputs {
        if !ids.contains(id) || records.len() > 20 {
            return Err(output_handoff_error());
        }
        for record in records {
            if record.session_id != *id
                || record.output.len() > 1024 * 1024
                || record.command.len() > 16 * 1024
                || record.id.len() > 128
                || record.command.chars().any(char::is_control)
                || record
                    .output
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
            {
                return Err(output_handoff_error());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod output_handoff_tests {
    use super::*;
    use crate::models::workspace::CommandOutputRecord;

    fn record() -> CommandOutputRecord {
        CommandOutputRecord {
            id: "0:1".into(),
            session_id: "pty".into(),
            generation: 0,
            sequence: 1,
            command: "demo".into(),
            started_at: 1,
            completed_at: 2,
            output: "example\n".into(),
            truncated: false,
            exit_code: Some(0),
        }
    }
    #[test]
    fn validates_membership_capacity_and_plain_text() {
        let ids = vec!["pty".into()];
        let mut outputs = CommandOutputHandoff::from([("pty".into(), vec![record()])]);
        assert!(validate_command_outputs(&ids, &outputs).is_ok());
        assert!(validate_command_outputs(&[], &outputs).is_err());
        outputs.get_mut("pty").unwrap()[0].output = "x".repeat(1024 * 1024 + 1);
        assert!(validate_command_outputs(&ids, &outputs).is_err());
        outputs.insert("pty".into(), vec![record(); 21]);
        assert!(validate_command_outputs(&ids, &outputs).is_err());
        outputs.insert("pty".into(), vec![record()]);
        outputs.get_mut("pty").unwrap()[0].session_id = "other".into();
        assert!(validate_command_outputs(&ids, &outputs).is_err());
    }
    #[test]
    fn handoff_is_owner_only_once_and_not_in_descriptors() {
        let manager = DetachedWorkspaceManager::default();
        let workspace = DetachedWorkspace {
            label: "detached-test".into(),
            parent_label: "main".into(),
            kind: DetachedWorkspaceKind::Workbench,
            title: "test".into(),
            terminal: None,
            sftp: None,
            workbench: Some(DetachedWorkbench {
                session_ids: vec!["pty".into()],
                ..Default::default()
            }),
        };
        manager
            .workspaces
            .lock()
            .unwrap()
            .insert(workspace.label.clone(), workspace);
        let mut queued = false;
        assert!(
            manager
                .with_terminal_owner("main", "pty", || {
                    queued = true;
                    Ok(())
                })
                .is_err()
        );
        assert!(!queued);
        manager
            .with_terminal_owner("detached-test", "pty", || {
                assert!(manager.workspaces.try_lock().is_err());
                queued = true;
                Ok(())
            })
            .unwrap();
        assert!(queued);
        let outputs = CommandOutputHandoff::from([("pty".into(), vec![record()])]);
        assert!(
            manager
                .validate_output_source("main", &["pty".into()], &outputs)
                .is_err()
        );
        assert!(
            manager
                .validate_output_source("detached-test", &["pty".into()], &outputs)
                .is_ok()
        );
        manager
            .command_outputs
            .lock()
            .unwrap()
            .insert("detached-test".into(), outputs);
        assert!(manager.take_command_outputs("other").is_err());
        assert_eq!(
            manager.take_command_outputs("detached-test").unwrap()["pty"].len(),
            1
        );
        assert!(
            manager
                .take_command_outputs("detached-test")
                .unwrap()
                .is_empty()
        );
        assert!(
            !serde_json::to_string(&manager.list().unwrap())
                .unwrap()
                .contains("commandOutputs")
        );
    }
}
