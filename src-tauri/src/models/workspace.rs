use serde::{Deserialize, Serialize};
use serde_json::Value;

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
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetachedWorkspaceKind {
    Terminal,
    Sftp,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedTerminalWorkspace {
    /// The terminal-window tab id. It remains stable even when the active pane
    /// changes inside a split layout.
    pub tab_session_id: String,
    pub session_ids: Vec<String>,
    /// Serialized pane layout owned by the renderer. Keeping the shape opaque
    /// lets UI-only layout revisions remain backward compatible with a running
    /// desktop process.
    pub layout: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedSftpWorkspace {
    pub profile_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDetachedTerminalRequest {
    pub parent_label: String,
    pub title: String,
    pub terminal: DetachedTerminalWorkspace,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDetachedSftpRequest {
    pub parent_label: String,
    pub title: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDetachedWorkspaceRequest {
    pub label: String,
    pub terminal: DetachedTerminalWorkspace,
}
