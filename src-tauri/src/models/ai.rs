use serde::{Deserialize, Serialize};
use serde_json::Value;

fn default_kind() -> String {
    "openai".to_string()
}

/// OpenAI-compatible model backend the agent talks to. Provided by the
/// frontend on every request so no API keys need to be persisted server-side.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    /// Base URL of the OpenAI-compatible API, e.g. `https://api.openai.com/v1/`.
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    /// Optional proxy URL (http/https/socks5) used to reach the API.
    #[serde(default)]
    pub proxy_url: String,
    /// Provider kind: `"openai"` (default) for a generic OpenAI-compatible
    /// endpoint, or `"copilot"` for GitHub Copilot (server-side device auth).
    #[serde(default = "default_kind")]
    pub kind: String,
}

/// Runtime knobs for a single agent run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunOptions {
    /// When true, `run_command` tool calls must be approved by the user before
    /// they execute against a server.
    #[serde(default = "default_true")]
    pub require_approval: bool,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_steps: Option<u32>,
    /// History compaction knobs (character budgets). `None` falls back to the
    /// built-in defaults in the agent.
    #[serde(default)]
    pub history_max_chars: Option<usize>,
    #[serde(default)]
    pub history_recent_chars: Option<usize>,
    #[serde(default)]
    pub history_chunk_chars: Option<usize>,
}

fn default_true() -> bool {
    true
}

impl Default for AiRunOptions {
    fn default() -> Self {
        Self {
            require_approval: true,
            temperature: None,
            max_steps: None,
            history_max_chars: None,
            history_recent_chars: None,
            history_chunk_chars: None,
        }
    }
}

/// A prior turn in the conversation (only the visible text is threaded across
/// runs; tool traffic is internal to each run).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListModelsRequest {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_kind")]
    pub kind: String,
}

/// Device-flow info returned to the UI when GitHub Copilot login starts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotDeviceInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Streamed to the frontend under the `copilot-auth` event as the background
/// device-flow poll progresses.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CopilotAuthEvent {
    /// Login completed and the GitHub token was stored.
    Success,
    /// Login failed, timed out, or was denied.
    Error { message: String },
}

/// The server the user is currently connected to in the active terminal,
/// passed as context so the agent defaults to operating on it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentServer {
    pub id: String,
    pub label: String,
    /// Id of the active interactive terminal session (`session-...`), used by
    /// the `read_terminal` tool to inspect the on-screen output.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Kind of the active terminal: `"ssh"` for a remote session or `"local"`
    /// for a local shell.
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSendMessageRequest {
    pub run_id: String,
    pub provider: AiProviderConfig,
    #[serde(default)]
    pub options: AiRunOptions,
    #[serde(default)]
    pub history: Vec<AiChatMessage>,
    pub message: String,
    #[serde(default)]
    pub current_server: Option<CurrentServer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApproveToolRequest {
    pub run_id: String,
    pub call_id: String,
    pub approved: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAnswerQuestionRequest {
    pub run_id: String,
    pub call_id: String,
    pub option_ids: Vec<String>,
}

/// Streamed to the frontend under the `ai-event` Tauri event as the agent
/// reasons and acts. `kind` discriminates the payload shape.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiEvent {
    /// A chunk of assistant reasoning / narration produced before tool calls.
    #[serde(rename_all = "camelCase")]
    Assistant { run_id: String, text: String },
    /// The model requested a tool. When `needs_approval` is true the run pauses
    /// until `ai_approve_tool` is called.
    #[serde(rename_all = "camelCase")]
    ToolCall {
        run_id: String,
        call_id: String,
        tool_name: String,
        args: Value,
        needs_approval: bool,
    },
    /// The observation produced by executing a tool.
    #[serde(rename_all = "camelCase")]
    ToolResult {
        run_id: String,
        call_id: String,
        tool_name: String,
        result: String,
        is_error: bool,
    },
    /// Requests that the frontend open a saved SSH profile after the user
    /// approved the corresponding tool call.
    #[serde(rename_all = "camelCase")]
    OpenSshSession {
        run_id: String,
        call_id: String,
        profile_id: String,
    },
    /// The agent's final answer for this run.
    #[serde(rename_all = "camelCase")]
    Final {
        run_id: String,
        text: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Error { run_id: String, message: String },
    /// Terminal event; the run is finished (success, error, or cancelled).
    #[serde(rename_all = "camelCase")]
    Done { run_id: String },
}
