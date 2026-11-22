use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::terminal::TerminalSnapshot;

/// A top-level workbench surface that has been moved out of the main window.
/// The registry is deliberately process-local: it only coordinates live Tauri
/// windows and never persists terminal/session data to disk.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedWorkspace {
    pub label: String,
    pub parent_label: String,
    pub kind: DetachedWorkspaceKind,
    pub title: String,
    pub terminal: Option<DetachedTerminalWorkspace>,
    pub sftp: Option<DetachedSftpWorkspace>,
    #[serde(default)]
    pub workbench: Option<DetachedWorkbench>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetachedWorkspaceKind {
    Terminal,
    Sftp,
    Workbench,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedTerminalWorkspace {
    /// The terminal-window tab id. It remains stable even when the active pane
    /// changes inside a split layout.
    pub tab_session_id: String,
    pub session_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running_session_ids: Option<Vec<String>>,
    #[serde(default)]
    pub auto_title: bool,
    /// Serialized pane layout owned by the renderer. Keeping the shape opaque
    /// lets UI-only layout revisions remain backward compatible with a running
    /// desktop process.
    pub layout: Option<Value>,
    /// Latest xterm screen state. It exists only while a detached window is
    /// returning to its parent and is never written to the database.
    #[serde(default)]
    pub terminal_snapshots: HashMap<String, TerminalSnapshot>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedSftpWorkspace {
    pub profile_id: String,
    pub asset: Option<DetachedSftpAsset>,
    pub remote_path: Option<String>,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedSftpAsset {
    pub address: String,
    pub account: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDetachedTerminalRequest {
    #[serde(default)]
    pub command_outputs: CommandOutputHandoff,
    pub parent_label: String,
    pub title: String,
    pub terminal: DetachedTerminalWorkspace,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDetachedSftpRequest {
    pub parent_label: String,
    pub title: String,
    #[serde(flatten)]
    pub sftp: DetachedSftpWorkspace,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDetachedWorkspaceRequest {
    pub label: String,
    pub terminal: DetachedTerminalWorkspace,
}

/// Renderer-owned state for a complete multi-tab window. No credentials are stored here.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedWorkbench {
    pub session_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running_session_ids: Option<Vec<String>>,
    pub layouts: Vec<Value>,
    pub terminal_names: HashMap<String, String>,
    pub pane_names: HashMap<String, String>,
    pub terminal_snapshots: HashMap<String, TerminalSnapshot>,
    pub sftp_tabs: Vec<Value>,
    pub tab_order: Vec<String>,
    pub s3_profile_ids: Vec<String>,
}

#[cfg(test)]
mod activity_compatibility_tests {
    use super::*;

    #[test]
    fn legacy_window_state_is_unknown_but_known_idle_survives_roundtrip() {
        let legacy: DetachedTerminalWorkspace = serde_json::from_value(serde_json::json!({
            "tabSessionId":"pty", "sessionIds":["pty"], "layout":null
        }))
        .unwrap();
        assert!(legacy.running_session_ids.is_none());
        assert!(
            serde_json::to_value(&legacy)
                .unwrap()
                .get("runningSessionIds")
                .is_none()
        );
        let known = DetachedTerminalWorkspace {
            running_session_ids: Some(vec![]),
            ..legacy
        };
        let restored: DetachedTerminalWorkspace =
            serde_json::from_value(serde_json::to_value(known).unwrap()).unwrap();
        assert_eq!(restored.running_session_ids, Some(vec![]));
        let workbench = DetachedWorkbench {
            running_session_ids: Some(vec!["pty".into()]),
            ..Default::default()
        };
        let restored: DetachedWorkbench =
            serde_json::from_value(serde_json::to_value(workbench).unwrap()).unwrap();
        assert_eq!(restored.running_session_ids, Some(vec!["pty".into()]));
    }
}

/// Only carried by an explicit handoff request, never a workspace descriptor.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputRecord {
    pub id: String,
    pub session_id: String,
    pub generation: u64,
    pub sequence: u64,
    pub command: String,
    pub started_at: u64,
    pub completed_at: u64,
    pub output: String,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
}
pub type CommandOutputHandoff = HashMap<String, Vec<CommandOutputRecord>>;
