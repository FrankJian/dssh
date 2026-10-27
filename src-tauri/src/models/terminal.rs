use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

/// Ephemeral xterm screen state passed between the parent and a detached
/// window. It is deliberately not persisted alongside terminal sessions.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    pub data: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub profile_id: String,
    pub title: String,
    pub kind: TerminalSessionKind,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionKind {
    Local,
    Ssh,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLocalSessionRequest {
    pub size: TerminalSize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSshSessionRequest {
    pub profile_id: String,
    pub size: TerminalSize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteSshSessionRequest {
    pub session_id: String,
    pub data: String,
    #[serde(default)]
    pub history_setup: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeSshSessionRequest {
    pub session_id: String,
    pub size: TerminalSize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatusEvent {
    pub session_id: String,
    pub status: SessionStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTransferPromptEvent {
    pub session_id: String,
    pub detection_id: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTransferConflictEvent {
    pub session_id: String,
    pub detection_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub file_index: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTransferStatusEvent {
    pub session_id: String,
    pub detection_id: String,
    pub direction: String,
    pub state: String,
    pub file_name: Option<String>,
    pub file_index: Option<u32>,
    pub file_count: Option<u32>,
    pub transferred: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Connecting,
    Connected,
    Reconnecting,
    Disconnecting,
    Disconnected,
    Exited,
    Failed,
}
