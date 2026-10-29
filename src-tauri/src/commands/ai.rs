use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    ai::{client::build_reqwest_client, run_agent},
    app::AppState,
    error::{AppError, AppResult},
    models::ai::{
        AiAnswerQuestionRequest, AiApproveToolRequest, AiListModelsRequest, AiProtocol,
        AiProviderConfig, AiSendMessageRequest,
    },
};

#[tauri::command]
pub fn ai_load_providers(state: State<'_, AppState>) -> AppResult<Vec<AiProviderConfig>> {
    state.profiles.list_ai_providers()
}

#[tauri::command]
pub fn ai_save_provider(
    state: State<'_, AppState>,
    provider: AiProviderConfig,
) -> AppResult<AiProviderConfig> {
    state.profiles.save_ai_provider(provider)
}

#[tauri::command]
pub fn ai_delete_provider(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.profiles.delete_ai_provider(&id)
}

/// Test the unsaved draft; only resolve an existing key when no replacement was supplied.
#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AppState>,
    mut provider: AiProviderConfig,
) -> AppResult<crate::ai::connection::AiConnectionTestResult> {
    if provider.api_key.is_none() {
        provider.api_key = state
            .profiles
            .get_secret(&format!("ai.provider.{}", provider.id))?;
    }
    crate::ai::connection::test_connection(provider).await
}

/// Discovery uses the saved descriptor and resolves its key only in Rust.
#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AppState>,
    request: AiListModelsRequest,
) -> AppResult<Vec<String>> {
    let provider = state.profiles.get_ai_provider(&request.provider_id)?;
    let base = crate::ai::providers::endpoint(&provider)?;
    let client = build_reqwest_client(&provider.proxy_url)?;
    let mut builder = client.get(format!("{base}models"));
    if provider.kind == AiProtocol::Anthropic {
        builder = builder.header("anthropic-version", "2023-06-01");
        if let Some(key) = provider.api_key.as_deref() {
            builder = builder.header("x-api-key", key);
        }
    } else if let Some(key) = provider.api_key.as_deref() {
        builder = builder.bearer_auth(key);
    }

    let response = builder.send().await.map_err(|_| {
        AppError::new(
            "ai_request_error",
            "无法获取模型列表，请检查连接与协议，或手动添加模型。",
        )
    })?;

    if !response.status().is_success() {
        let status = response.status();
        return Err(AppError::new(
            "ai_request_error",
            format!("获取模型列表失败（HTTP {status}），请检查密钥和 API 地址，或手动添加模型。"),
        ));
    }

    let payload: serde_json::Value = response.json().await.map_err(|_| {
        AppError::new(
            "ai_request_error",
            "无法获取模型列表，请检查连接与协议，或手动添加模型。",
        )
    })?;

    let mut models = extract_model_ids(&payload);
    models.sort();
    models.dedup();
    Ok(models)
}

/// Start a ReAct agent run. Events are streamed back over the `ai-event`
/// channel; the run is identified by `request.run_id`.
#[tauri::command]
pub async fn ai_send_message(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: AiSendMessageRequest,
) -> AppResult<()> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        run_agent(app_handle, state, request).await;
    });
    Ok(())
}

/// Approve or reject a pending tool call for a run.
#[tauri::command]
pub fn ai_approve_tool(state: State<'_, AppState>, request: AiApproveToolRequest) -> AppResult<()> {
    state
        .ai
        .approve(&request.run_id, &request.call_id, request.approved);
    Ok(())
}

/// Answer an interactive question requested by the AI agent.
#[tauri::command]
pub fn ai_answer_question(
    state: State<'_, AppState>,
    request: AiAnswerQuestionRequest,
) -> AppResult<()> {
    state
        .ai
        .answer_question(&request.run_id, &request.call_id, request.option_ids);
    Ok(())
}

/// Cancel an in-flight run.
#[tauri::command]
pub fn ai_cancel_run(state: State<'_, AppState>, run_id: String) -> AppResult<()> {
    state.ai.cancel(&run_id);
    Ok(())
}

#[tauri::command]
pub fn ai_load_chat_history(state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    state.profiles.load_ai_chat_history()
}

#[tauri::command]
pub fn ai_save_chat_history(state: State<'_, AppState>, items: Vec<Value>) -> AppResult<()> {
    state.profiles.save_ai_chat_history(items)
}

#[tauri::command]
pub fn ai_clear_chat_history(state: State<'_, AppState>) -> AppResult<()> {
    state.profiles.clear_ai_chat_history()
}

fn extract_model_ids(payload: &serde_json::Value) -> Vec<String> {
    // OpenAI-compatible shape: { "data": [ { "id": "..." }, ... ] }
    if let Some(data) = payload.get("data").and_then(|value| value.as_array()) {
        return data
            .iter()
            .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
            .map(|id| id.to_string())
            .collect();
    }
    // Ollama native shape: { "models": [ { "name": "..." }, ... ] }
    if let Some(models) = payload.get("models").and_then(|value| value.as_array()) {
        return models
            .iter()
            .filter_map(|item| {
                item.get("id")
                    .or_else(|| item.get("name"))
                    .and_then(|value| value.as_str())
            })
            .map(|id| id.to_string())
            .collect();
    }
    Vec::new()
}
