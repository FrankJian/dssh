use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Explicit wire protocol; model names must never determine the adapter.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum AiProtocol {
    #[default]
    #[serde(rename = "openai-completions", alias = "openai")]
    Completions,
    #[serde(rename = "openai-responses")]
    Responses,
    #[serde(rename = "anthropic-messages")]
    Anthropic,
}

pub const DEFAULT_MODEL_CONTEXT_WINDOW: u32 = 256_000;

pub const DEFAULT_MODEL_MAX_OUTPUT_TOKENS: u32 = 32_000;

fn default_input_types() -> Vec<String> {
    vec!["text".into()]
}

fn default_context_window() -> u32 {
    DEFAULT_MODEL_CONTEXT_WINDOW
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReasoningLevel {
    pub level: String,
    #[serde(default)]
    pub api_value: String,
}

pub fn default_reasoning_levels() -> Vec<AiReasoningLevel> {
    ["off", "low", "medium", "high"]
        .into_iter()
        .map(|level| AiReasoningLevel {
            level: level.into(),
            api_value: if level == "off" {
                String::new()
            } else {
                level.into()
            },
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(from = "StoredAiModel", rename_all = "camelCase")]
pub struct AiModelConfig {
    pub id: String,
    pub display_name: String,
    pub context_window: u32,
    pub max_output_tokens: u32,
    pub input_types: Vec<String>,
    pub reasoning_effort: Option<String>,
    pub reasoning_levels: Vec<AiReasoningLevel>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredAiModel {
    Id(String),
    Config {
        id: String,
        #[serde(default, rename = "displayName")]
        display_name: String,
        #[serde(default = "default_context_window", rename = "contextWindow")]
        context_window: u32,
        #[serde(default, rename = "maxOutputTokens")]
        max_output_tokens: Option<u32>,
        #[serde(default = "default_input_types", rename = "inputTypes")]
        input_types: Vec<String>,
        #[serde(default, rename = "reasoningEffort")]
        reasoning_effort: Option<String>,
        #[serde(default, rename = "reasoningLevels")]
        reasoning_levels: Option<Vec<AiReasoningLevel>>,
    },
}

impl From<StoredAiModel> for AiModelConfig {
    fn from(value: StoredAiModel) -> Self {
        match value {
            StoredAiModel::Id(id) => Self::from_id(id),
            StoredAiModel::Config {
                id,
                display_name,
                context_window,
                max_output_tokens,
                input_types,
                reasoning_effort,
                reasoning_levels,
            } => {
                let levels = reasoning_levels.unwrap_or_else(|| {
                    if reasoning_effort.is_some() {
                        default_reasoning_levels()
                    } else {
                        vec![]
                    }
                });
                let selected = reasoning_effort
                    .filter(|level| levels.iter().any(|row| &row.level == level))
                    .or_else(|| {
                        levels
                            .iter()
                            .find(|row| row.level == "medium")
                            .or_else(|| levels.first())
                            .map(|row| row.level.clone())
                    });
                Self {
                    display_name: if display_name.trim().is_empty() {
                        id.clone()
                    } else {
                        display_name
                    },
                    id,
                    context_window,
                    max_output_tokens: max_output_tokens
                        .unwrap_or(DEFAULT_MODEL_MAX_OUTPUT_TOKENS.min(context_window / 4)),
                    input_types,
                    reasoning_effort: selected,
                    reasoning_levels: levels,
                }
            }
        }
    }
}

impl AiModelConfig {
    pub fn from_id(id: String) -> Self {
        Self {
            display_name: id.clone(),
            id,
            context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
            max_output_tokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
            input_types: default_input_types(),
            reasoning_effort: None,
            reasoning_levels: vec![],
        }
    }
}

/// Stored descriptor. Secrets are accepted on writes and never serialized.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    #[serde(default)]
    pub preset_id: Option<String>,
    pub id: String,
    pub label: String,
    pub base_url: String,
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub has_api_key: bool,
    pub model: String,
    #[serde(default)]
    pub models: Vec<AiModelConfig>,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub kind: AiProtocol,
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
    pub provider_id: String,
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
    pub conversation_id: String,
    pub provider_id: String,
    pub model: String,
    #[serde(default)]
    pub reasoning_level: Option<String>,
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
    /// Requests a validated, non-destructive application UI action. The
    /// frontend owns execution because workspace state is renderer-local.
    #[serde(rename_all = "camelCase")]
    AppAction {
        run_id: String,
        call_id: String,
        action: String,
        args: Value,
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
