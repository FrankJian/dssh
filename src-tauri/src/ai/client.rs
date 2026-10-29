use genai::adapter::AdapterKind;
use genai::chat::{
    ChatMessage, ChatOptions, ChatRequest, ChatResponse, ContentPart, MessageContent,
};
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, ServiceTarget};

use crate::{
    error::{AppError, AppResult},
    models::ai::{AiProtocol, AiProviderConfig},
};

/// Resolve the endpoint, credentials and protocol explicitly for every request.
pub fn build_client(provider: &AiProviderConfig) -> AppResult<AiClient> {
    let mut resolved = provider.clone();
    super::providers::resolve_preset(&mut resolved)?;
    let provider = &resolved;
    let base_url = super::providers::endpoint(provider)?;
    let adapter = adapter_kind(provider.kind);
    let api_key = provider.api_key.clone().unwrap_or_default();

    let resolver = ServiceTargetResolver::from_resolver_fn(
        move |service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { model, .. } = service_target;
            let endpoint = Endpoint::from_owned(base_url.clone());
            let auth = if api_key.trim().is_empty() {
                AuthData::from_single("no-key")
            } else {
                AuthData::from_single(api_key.clone())
            };
            let model = ModelIden::new(adapter, model.model_name);
            Ok(ServiceTarget {
                endpoint,
                auth,
                model,
            })
        },
    );

    let http_client = build_reqwest_client(&provider.proxy_url)?;

    let native = if provider.kind == AiProtocol::Anthropic {
        Some(super::anthropic::AnthropicClient {
            http: http_client.clone(),
            base_url: super::providers::endpoint(provider)?,
            api_key: provider.api_key.clone().unwrap_or_default(),
        })
    } else {
        None
    };
    Ok(AiClient {
        genai: Client::builder()
            .with_service_target_resolver(resolver)
            .with_reqwest(http_client)
            .build(),
        native,
    })
}

pub struct AiClient {
    genai: Client,
    native: Option<super::anthropic::AnthropicClient>,
}

impl AiClient {
    pub async fn exec_chat(
        &self,
        model: &str,
        request: ChatRequest,
        options: Option<&ChatOptions>,
    ) -> AppResult<ChatResponse> {
        if let Some(native) = &self.native {
            return native.exec_chat(model, request, options).await;
        }
        self.genai
            .exec_chat(model, request, options)
            .await
            .map_err(|_| {
                AppError::new(
                    "ai_request_error",
                    "模型请求失败，请检查 API 地址、协议、密钥及模型是否可用。",
                )
            })
    }
}

pub fn adapter_kind(protocol: AiProtocol) -> AdapterKind {
    match protocol {
        AiProtocol::Completions => AdapterKind::OpenAI,
        AiProtocol::Responses => AdapterKind::OpenAIResp,
        AiProtocol::Anthropic => AdapterKind::Anthropic,
    }
}

pub fn build_reqwest_client(proxy_url: &str) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(180));
    let trimmed = proxy_url.trim();
    if !trimmed.is_empty() {
        let proxy = reqwest::Proxy::all(trimmed)
            .map_err(|_| AppError::new("ai_proxy_error", "代理地址无效。"))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|_| AppError::new("ai_request_error", "无法创建模型连接。"))
}

/// Accept an API base or a complete endpoint, preserving gateway path prefixes.
pub fn normalize_base_url(base_url: &str) -> AppResult<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let mut url = reqwest::Url::parse(trimmed)
        .map_err(|_| AppError::new("ai_config_error", "请填写有效的 HTTP / HTTPS API 地址。"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::new(
            "ai_config_error",
            "API 地址仅支持 HTTP / HTTPS，不能包含凭据、查询参数或片段。",
        ));
    }
    let path = url.path().trim_end_matches('/');
    let path = ["/chat/completions", "/responses", "/messages"]
        .iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(path);
    let path = if path.is_empty() {
        "/v1/".to_string()
    } else {
        format!("{path}/")
    };
    url.set_path(&path);
    Ok(url.to_string())
}

/// Preserve assistant text, tool calls and protocol-specific reasoning across
/// tool iterations. genai's non-streaming Responses parser drops reasoning items.
pub fn assistant_message(response: &ChatResponse, protocol: AiProtocol) -> ChatMessage {
    if protocol == AiProtocol::Anthropic
        && let Some(blocks) = response
            .captured_raw_body
            .as_ref()
            .and_then(|body| body["content"].as_array())
    {
        return ChatMessage::assistant(MessageContent::from_parts(
            blocks
                .iter()
                .map(|block| {
                    ContentPart::from_custom(block.clone(), Some(response.model_iden.clone()))
                })
                .collect::<Vec<_>>(),
        ));
    }
    let mut content = response.content.clone();
    if protocol == AiProtocol::Responses
        && let Some(items) = response
            .captured_raw_body
            .as_ref()
            .and_then(|body| body.get("output"))
            .and_then(|output| output.as_array())
    {
        for item in items {
            if item.get("type").and_then(|v| v.as_str()) == Some("reasoning")
                && let Some(blob) = item.get("encrypted_content").and_then(|v| v.as_str())
            {
                content.push(ContentPart::ThoughtSignature(blob.to_string()));
            }
        }
    }
    ChatMessage::assistant(content).with_reasoning_content(response.reasoning_content.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use genai::chat::{ChatOptions, ChatRequest, Tool, ToolResponse};
    use serde_json::{Value, json};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn endpoint_normalization_preserves_gateway_prefixes() {
        for (input, expected) in [
            (" https://api.example.test ", "https://api.example.test/v1/"),
            (
                "https://gateway.test/api/v4/chat/completions",
                "https://gateway.test/api/v4/",
            ),
            (
                "https://gateway.test/anthropic/v1/messages/",
                "https://gateway.test/anthropic/v1/",
            ),
            (
                "http://localhost:11434/v1/responses",
                "http://localhost:11434/v1/",
            ),
        ] {
            assert_eq!(normalize_base_url(input).unwrap(), expected);
        }
        for invalid in [
            "",
            "file:///etc/passwd",
            "https://user:pass@gateway.test",
            "https://api.test/v1?key=x",
        ] {
            assert!(normalize_base_url(invalid).is_err());
        }
        assert!(serde_json::from_value::<AiProtocol>(json!("copilot")).is_err());
        assert_eq!(
            serde_json::from_value::<AiProtocol>(json!("openai")).unwrap(),
            AiProtocol::Completions
        );
    }

    /// Exercise actual genai serialization/parsing through a local HTTP server.
    /// The deliberately ambiguous model name proves protocol selection wins over inference.
    #[tokio::test]
    async fn three_protocols_roundtrip_tool_calls_and_results() {
        for protocol in [
            AiProtocol::Completions,
            AiProtocol::Responses,
            AiProtocol::Anthropic,
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                for turn in 0..2 {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut bytes = Vec::new();
                    let header_end = loop {
                        let mut chunk = [0; 4096];
                        let len = socket.read(&mut chunk).await.unwrap();
                        assert_ne!(len, 0);
                        bytes.extend_from_slice(&chunk[..len]);
                        if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                            break index + 4;
                        }
                    };
                    let headers = String::from_utf8_lossy(&bytes[..header_end]).to_lowercase();
                    let size: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    while bytes.len() < header_end + size {
                        let mut chunk = [0; 4096];
                        let len = socket.read(&mut chunk).await.unwrap();
                        assert_ne!(len, 0);
                        bytes.extend_from_slice(&chunk[..len]);
                    }
                    let body: Value =
                        serde_json::from_slice(&bytes[header_end..header_end + size]).unwrap();
                    assert_eq!(body["model"], "ambiguous-model");
                    let output_limit = match protocol {
                        AiProtocol::Responses => body.get("max_output_tokens"),
                        AiProtocol::Completions => body
                            .get("max_completion_tokens")
                            .or_else(|| body.get("max_tokens")),
                        AiProtocol::Anthropic => body.get("max_tokens"),
                    };
                    assert_eq!(output_limit, Some(&json!(32000)));
                    let effort = match protocol {
                        AiProtocol::Completions => &body["reasoning_effort"],
                        AiProtocol::Responses => &body["reasoning"]["effort"],
                        AiProtocol::Anthropic => &body["output_config"]["effort"],
                    };
                    assert_eq!(effort, "custom-effort");

                    let path = match protocol {
                        AiProtocol::Completions => "chat/completions",
                        AiProtocol::Responses => "responses",
                        AiProtocol::Anthropic => "messages",
                    };
                    assert!(headers.starts_with(&format!("post /gateway/v1/{path} ")));
                    if protocol == AiProtocol::Anthropic {
                        assert!(headers.contains("anthropic-version:"));
                        assert!(headers.contains("x-api-key: synthetic-local-credential"));
                        assert!(!headers.contains("authorization:"));
                        assert!(body["max_tokens"].is_number());
                    } else {
                        assert!(
                            headers.contains("authorization: bearer synthetic-local-credential")
                        );
                    }
                    if turn == 0 {
                        let tool = &body["tools"][0];
                        match protocol {
                            AiProtocol::Completions => {
                                assert_eq!(tool["function"]["name"], "inspect_host")
                            }
                            _ => assert_eq!(tool["name"], "inspect_host"),
                        }
                    } else {
                        let serialized = body.to_string();
                        assert!(serialized.contains("host-result"));
                        assert!(serialized.contains("call_1"));
                        if protocol == AiProtocol::Responses {
                            assert_eq!(body["store"], false);
                            let input = body["input"].as_array().unwrap();
                            assert!(
                                input.iter().any(|v| v["type"] == "function_call_output"
                                    && v["call_id"] == "call_1")
                            );
                            assert!(input.iter().any(|v| v["type"] == "reasoning"
                                && v["encrypted_content"] == "opaque-test-blob"));
                        }
                        if protocol == AiProtocol::Anthropic {
                            assert!(serialized.contains("tool_result"));
                            assert!(serialized.contains("tool_use"));
                            let blocks = body["messages"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .find(|m| m["role"] == "assistant")
                                .unwrap()["content"]
                                .as_array()
                                .unwrap();
                            assert_eq!(
                                blocks[0],
                                json!({"type":"thinking","thinking":"private test reasoning","signature":"opaque-test-signature"})
                            );
                            assert_eq!(
                                blocks[1],
                                json!({"type":"redacted_thinking","data":"opaque-redacted-block"})
                            );
                        }
                    }
                    let response = match (protocol, turn) {
                        (AiProtocol::Completions, 0) => json!({"model":"ambiguous-model","choices":[{"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"inspect_host","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}),
                        (AiProtocol::Completions, _) => json!({"model":"ambiguous-model","choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}),
                        (AiProtocol::Responses, 0) => json!({"id":"resp_1","model":"ambiguous-model","status":"completed","output":[{"type":"reasoning","encrypted_content":"opaque-test-blob","summary":[]},{"type":"function_call","call_id":"call_1","name":"inspect_host","arguments":"{}"}]}),
                        (AiProtocol::Responses, _) => json!({"id":"resp_2","model":"ambiguous-model","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}]}),
                        (AiProtocol::Anthropic, 0) => json!({"model":"ambiguous-model","role":"assistant","content":[{"type":"thinking","thinking":"private test reasoning","signature":"opaque-test-signature"},{"type":"redacted_thinking","data":"opaque-redacted-block"},{"type":"tool_use","id":"call_1","name":"inspect_host","input":{}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}}),
                        (AiProtocol::Anthropic, _) => json!({"model":"ambiguous-model","role":"assistant","content":[{"type":"text","text":"done"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}),
                    }.to_string();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        response.len(),
                        response
                    );
                    socket.write_all(response.as_bytes()).await.unwrap();
                }
            });
            let provider = AiProviderConfig {
                preset_id: Some("custom".into()),
                id: "test".into(),
                label: "test".into(),
                base_url: format!("http://{address}/gateway/v1/"),
                api_key: Some("synthetic-local-credential".into()),
                has_api_key: false,
                model: "ambiguous-model".into(),
                models: vec![],
                proxy_url: String::new(),
                kind: protocol,
            };
            let client = build_client(&provider).unwrap();
            let options = ChatOptions::default()
                .with_capture_raw_body(true)
                .with_max_tokens(32000)
                .with_extra_body(crate::ai::reasoning::payload(
                    protocol,
                    None,
                    &crate::models::ai::AiReasoningLevel {
                        level: "high".into(),
                        api_value: "custom-effort".into(),
                    },
                ));
            let request = ChatRequest::from_user("inspect")
                .with_system("system")
                .with_tools([
                    Tool::new("inspect_host").with_schema(json!({"type":"object","properties":{}}))
                ]);
            let first = client
                .exec_chat(&provider.model, request.clone(), Some(&options))
                .await
                .unwrap();
            assert_eq!(first.tool_calls().len(), 1);
            let next = request
                .append_message(assistant_message(&first, protocol))
                .append_message(ToolResponse::new("call_1", "host-result"));
            let result = client
                .exec_chat(&provider.model, next, Some(&options))
                .await
                .unwrap();
            assert_eq!(result.first_text(), Some("done"));
            server.await.unwrap();
        }
    }
}
