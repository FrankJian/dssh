use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    ai::{
        client::{build_reqwest_client, build_reqwest_client_with, normalize_base_url},
        copilot, run_agent,
    },
    app::AppState,
    error::{AppError, AppResult},
    models::ai::{
        AiAnswerQuestionRequest, AiApproveToolRequest, AiListModelsRequest, AiSendMessageRequest,
        CopilotDeviceInfo,
    },
};

/// Fetch the list of available model ids from an OpenAI-compatible endpoint
/// (`GET {base_url}/models`). Works for OpenAI, DeepSeek, OpenRouter, Ollama,
/// LM Studio, vLLM, and other compatible servers. For Copilot, resolves the
/// account's API base and session token first, then queries with the required
/// editor-identity headers.
#[tauri::command]
pub async fn ai_list_models(
    state: State<'_, AppState>,
    request: AiListModelsRequest,
) -> AppResult<Vec<String>> {
    let (url, client, bearer) = if request.kind == "copilot" {
        let (api_base, token) =
            copilot::ensure_session_token(state.inner(), &request.proxy_url).await?;
        let base = normalize_base_url(&api_base);
        let client = build_reqwest_client_with(&request.proxy_url, Some(copilot::api_headers()))?;
        (format!("{base}models"), client, Some(token))
    } else {
        let base = normalize_base_url(&request.base_url);
        if base.is_empty() {
            return Err(AppError::new("ai_config_error", "请先填写 API 地址。"));
        }
        let client = build_reqwest_client(&request.proxy_url)?;
        let key = request.api_key.trim();
        let bearer = if key.is_empty() {
            None
        } else {
            Some(key.to_string())
        };
        (format!("{base}models"), client, bearer)
    };

    let mut builder = client.get(&url);
    if let Some(bearer) = bearer {
        builder = builder.bearer_auth(bearer);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| AppError::new("ai_request_error", error.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            "ai_request_error",
            format!("获取模型列表失败（HTTP {status}）：{body}"),
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| AppError::new("ai_request_error", error.to_string()))?;

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

/// Begin the GitHub Copilot device-login flow. Returns the code/URL to show the
/// user; completion is reported asynchronously via `copilot-auth` events.
#[tauri::command]
pub async fn ai_copilot_start_login(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    proxy_url: Option<String>,
) -> AppResult<CopilotDeviceInfo> {
    let state = state.inner().clone();
    copilot::start_login(app_handle, state, proxy_url.unwrap_or_default()).await
}

/// Cancel an in-flight Copilot device-login poll (e.g. the dialog was closed).
#[tauri::command]
pub fn ai_copilot_cancel_login(state: State<'_, AppState>) -> AppResult<()> {
    copilot::cancel_login(state.inner());
    Ok(())
}

/// Whether the user is currently logged in to GitHub Copilot.
#[tauri::command]
pub fn ai_copilot_status(state: State<'_, AppState>) -> AppResult<bool> {
    copilot::status(state.inner())
}

/// Log out of GitHub Copilot, clearing the stored token and cached session.
#[tauri::command]
pub async fn ai_copilot_logout(state: State<'_, AppState>) -> AppResult<()> {
    copilot::logout(state.inner()).await
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
