//! Native Messages transport preserves every assistant block (including signed
//! thinking) across tool iterations, which genai's current adapter discards.
use crate::{
    error::{AppError, AppResult},
    models::ai::DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
};
use genai::ModelIden;
use genai::adapter::AdapterKind;
use genai::chat::{
    ChatOptions, ChatRequest, ChatResponse, ChatRole, ContentPart, MessageContent, ToolCall,
};
use serde_json::{Value, json};

pub struct AnthropicClient {
    pub http: reqwest::Client,
    pub base_url: String,
    pub api_key: String,
}

fn protocol_error() -> AppError {
    AppError::new(
        "ai_protocol_error",
        "Anthropic 响应格式无效，请检查协议与模型配置。",
    )
}

impl AnthropicClient {
    pub async fn exec_chat(
        &self,
        model: &str,
        request: ChatRequest,
        options: Option<&ChatOptions>,
    ) -> AppResult<ChatResponse> {
        let mut system = request.system.unwrap_or_default();
        let mut messages: Vec<Value> = Vec::new();
        for message in request.messages {
            if message.role == ChatRole::System {
                if let Some(text) = message.content.joined_texts() {
                    system.push('\n');
                    system.push_str(&text);
                }
                continue;
            }
            let role = if message.role == ChatRole::Assistant {
                "assistant"
            } else {
                "user"
            };
            let mut content = Vec::new();
            for part in message.content {
                content.push(match part {
                    ContentPart::Text(text) => json!({"type":"text", "text":text}),
                    ContentPart::ToolCall(call) => json!({"type":"tool_use", "id":call.call_id, "name":call.fn_name, "input":call.fn_arguments}),
                    ContentPart::ToolResponse(result) => json!({"type":"tool_result", "tool_use_id":result.call_id, "content":result.content}),
                    ContentPart::Custom(part) => part.data,
                    _ => return Err(AppError::new("ai_protocol_error", "当前助手仅支持文本与工具调用。")),
                });
            }
            // Multiple tool results must belong to the same user turn.
            if let Some(previous) = messages.last_mut()
                && previous["role"] == role
                && let Some(parts) = previous["content"].as_array_mut()
            {
                parts.extend(content);
            } else {
                messages.push(json!({"role":role,"content":content}));
            }
        }
        let mut payload = json!({
            "model": model, "messages": messages,
            "max_tokens": options.and_then(|o| o.max_tokens).unwrap_or(DEFAULT_MODEL_MAX_OUTPUT_TOKENS),
        });
        if !system.is_empty() {
            payload["system"] = json!(system);
        }
        if let Some(temperature) = options.and_then(|o| o.temperature) {
            payload["temperature"] = json!(temperature);
        }
        if let Some(tools) = request.tools {
            payload["tools"] = json!(tools.into_iter().map(|tool| json!({
                "name": tool.name, "description": tool.description.unwrap_or_default(),
                "input_schema": tool.schema.unwrap_or_else(|| json!({"type":"object","properties":{}})),
            })).collect::<Vec<_>>());
        }
        if let Some(extra) = options
            .and_then(|options| options.extra_body.as_ref())
            .and_then(|value| value.as_object())
        {
            for (key, value) in extra {
                payload[key] = value.clone();
            }
            if payload["thinking"]["type"]
                .as_str()
                .is_some_and(|kind| kind != "disabled")
            {
                payload
                    .as_object_mut()
                    .expect("object payload")
                    .remove("temperature");
            }
        }
        let mut builder = self
            .http
            .post(format!("{}messages", self.base_url))
            .header("anthropic-version", "2023-06-01");
        if !self.api_key.is_empty() {
            builder = builder.header("x-api-key", &self.api_key);
        }
        let response = builder
            .json(&payload)
            .send()
            .await
            .map_err(|_| AppError::new("ai_request_error", "无法连接 Anthropic 模型服务。"))?;
        if !response.status().is_success() {
            return Err(AppError::new(
                "ai_request_error",
                format!(
                    "模型请求失败（HTTP {}），请检查地址、协议和认证。",
                    response.status()
                ),
            ));
        }
        let body: Value = response.json().await.map_err(|_| protocol_error())?;
        let mut content = MessageContent::default();
        for block in body["content"].as_array().ok_or_else(protocol_error)? {
            match block["type"].as_str() {
                Some("text") => content.push(ContentPart::Text(
                    block["text"]
                        .as_str()
                        .ok_or_else(protocol_error)?
                        .to_string(),
                )),
                Some("tool_use") => content.push(ContentPart::ToolCall(ToolCall {
                    call_id: block["id"].as_str().ok_or_else(protocol_error)?.to_string(),
                    fn_name: block["name"]
                        .as_str()
                        .ok_or_else(protocol_error)?
                        .to_string(),
                    fn_arguments: block["input"].clone(),
                    thought_signatures: None,
                })),
                _ => {} // Raw blocks remain in captured_raw_body for verbatim replay.
            }
        }
        let model_iden = ModelIden::new(AdapterKind::Anthropic, model);
        Ok(ChatResponse {
            content,
            reasoning_content: None,
            model_iden: model_iden.clone(),
            provider_model_iden: model_iden,
            usage: Default::default(),
            stop_reason: body["stop_reason"]
                .as_str()
                .map(|reason| reason.to_string().into()),
            captured_raw_body: Some(body),
            response_id: None,
        })
    }
}
