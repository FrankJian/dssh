use genai::chat::{ChatMessage, ChatOptions, ChatRequest};
use serde::Serialize;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

use super::diagnostics::{
    Redactor, network_error, proxy_description, response_error, safe_url, status_hint,
};
use crate::{
    error::{AppError, AppResult},
    models::ai::{AiModelConfig, AiProtocol, AiProviderConfig},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    pub success: bool,
    pub message: String,
    pub model: String,
    pub elapsed_ms: u64,
    pub details: AiConnectionDiagnostics,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionDiagnostics {
    pub protocol: AiProtocol,
    pub stage: String,
    pub method: &'static str,
    pub api_url: Option<String>,
    pub proxy: String,
    pub authentication_configured: bool,
    pub request_headers: Value,
    pub request_body: Option<Value>,
    pub http_status: Option<u16>,
    pub response_headers: Value,
    pub response_error: Option<Value>,
    pub error_type: Option<String>,
    pub cause: Option<String>,
}

/// An actual inference probe, with its exact body and sanitized transport diagnostics.
/// Expected configuration / HTTP failures are structured results so UI can expand details.
pub async fn test_connection(mut provider: AiProviderConfig) -> AppResult<AiConnectionTestResult> {
    let started = Instant::now();
    provider.api_key = provider.api_key.map(|key| key.trim().to_string());
    let redactor = Redactor::new(provider.api_key.as_deref(), &provider.proxy_url);
    let mut result = AiConnectionTestResult {
        success: false,
        message: String::new(),
        model: redactor.text(provider.model.trim()),
        elapsed_ms: 0,
        details: AiConnectionDiagnostics {
            protocol: provider.kind,
            stage: "validate_config".into(),
            method: "POST",
            api_url: None,
            proxy: redactor.text(&proxy_description(&provider.proxy_url)),
            authentication_configured: provider
                .api_key
                .as_deref()
                .is_some_and(|key| !key.is_empty()),
            request_headers: json!({}),
            request_body: None,
            http_status: None,
            response_headers: json!({}),
            response_error: None,
            error_type: None,
            cause: None,
        },
    };
    let outcome = tokio::time::timeout(
        Duration::from_secs(30),
        probe(&mut provider, &mut result, &redactor),
    )
    .await;
    match outcome {
        Ok(Ok(())) => {
            result.success = true;
            result.message = "连接成功".into();
        }
        Ok(Err(error)) => {
            result.message = redactor.text(&error.message);
            result.details.error_type.get_or_insert(error.code);
        }
        Err(_) => {
            result.message = "连接测试超时（30 秒）；请检查网络、代理及模型响应速度。".into();
            result.details.error_type = Some("timeout".into());
        }
    }
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}

async fn probe(
    provider: &mut AiProviderConfig,
    result: &mut AiConnectionTestResult,
    redactor: &Redactor,
) -> AppResult<()> {
    super::providers::resolve_preset(provider)?;
    result.details.protocol = provider.kind;
    provider.model = provider.model.trim().to_string();
    if provider.model.is_empty() {
        return Err(AppError::new(
            "ai_config_error",
            "请先填写默认模型 ID，再测试连接。",
        ));
    }
    let base = super::providers::endpoint(provider)?;
    let suffix = match provider.kind {
        AiProtocol::Completions => "chat/completions",
        AiProtocol::Responses => "responses",
        AiProtocol::Anthropic => "messages",
    };
    let url = format!("{base}{suffix}");
    result.details.api_url = safe_url(&url).map(|url| redactor.text(&url));
    let model = provider
        .models
        .iter()
        .find(|model| model.id == provider.model)
        .cloned()
        .unwrap_or_else(|| AiModelConfig::from_id(provider.model.clone()));
    // Legacy Messages thinking needs budget_tokens >= 1024 AND max_tokens > budget.
    // A short probe may use up to 2048 tokens when that configured feature is on.
    let reasoning_on = model
        .reasoning_effort
        .as_deref()
        .is_some_and(|effort| effort != "off");
    let limit = if provider.kind == AiProtocol::Anthropic
        && reasoning_on
        && super::reasoning::legacy_anthropic_thinking(&model.id)
    {
        2048
    } else {
        1024
    };
    let mut options =
        ChatOptions::default().with_max_tokens(model.max_output_tokens.clamp(1, limit));
    super::reasoning::apply(
        &mut options,
        provider.kind,
        provider.preset_id.as_deref(),
        &model,
        None,
    )?;
    let request = ChatRequest::new(vec![ChatMessage::user("Reply with OK only.")]);
    let mut body = match provider.kind {
        AiProtocol::Anthropic => {
            super::anthropic::prepare_payload(&provider.model, request, Some(&options))?
        }
        AiProtocol::Completions => {
            let mut payload = json!({"model":provider.model,"messages":[{"role":"user","content":"Reply with OK only."}],"stream":false});
            let key = if ["gpt-5", "o1", "o3", "o4"]
                .iter()
                .any(|prefix| provider.model.starts_with(prefix))
            {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
            payload[key] = json!(options.max_tokens);
            payload
        }
        AiProtocol::Responses => {
            json!({"model":provider.model,"input":[{"role":"user","content":[{"type":"input_text","text":"Reply with OK only."}]}],"max_output_tokens":options.max_tokens,"store":false,"stream":false})
        }
    };
    if provider.kind != AiProtocol::Anthropic
        && let Some(extra) = options
            .extra_body
            .and_then(|value| value.as_object().cloned())
    {
        body.as_object_mut().expect("object payload").extend(extra);
    }
    result.details.request_body = Some(redactor.value(&body));
    result.details.stage = "build_request".into();
    let http = super::client::build_reqwest_client(&provider.proxy_url)?;
    let mut builder = http.post(&url);
    if provider.kind == AiProtocol::Anthropic {
        builder = builder.header("anthropic-version", "2023-06-01");
        if let Some(key) = &provider.api_key
            && !key.is_empty()
        {
            builder = builder.header("x-api-key", key);
        }
    } else if let Some(key) = &provider.api_key
        && !key.is_empty()
    {
        builder = builder.bearer_auth(key);
    }
    let request = builder.json(&body).build().map_err(|error| {
        AppError::new(
            "ai_request_build",
            format!("无法构造请求：{}", redactor.text(&error.to_string())),
        )
    })?;
    result.details.request_headers = redactor.value(
        &serde_json::to_value(
            request
                .headers()
                .iter()
                .map(|(name, value)| (name.as_str(), value.to_str().unwrap_or("[非文本头]")))
                .collect::<std::collections::BTreeMap<_, _>>(),
        )
        .expect("headers JSON"),
    );
    result.details.stage = "send_request".into();
    let mut response = http.execute(request).await.map_err(|error| {
        let (kind, cause) = network_error(&error);
        result.details.error_type = Some(kind.into());
        result.details.cause = Some(redactor.text(&cause));
        AppError::new(
            "ai_connection_error",
            if error.is_timeout() {
                "请求超时，请检查网络、代理或模型响应速度。"
            } else {
                "无法连接模型接口；请展开详情检查 DNS、连接、TLS 或代理错误。"
            },
        )
    })?;
    let status = response.status().as_u16();
    result.details.http_status = Some(status);
    result.details.response_headers = redactor.value(
        &serde_json::to_value(
            [
                "content-type",
                "request-id",
                "x-request-id",
                "retry-after",
                "location",
            ]
            .into_iter()
            .filter_map(|name| {
                response
                    .headers()
                    .get(name)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| {
                        (
                            name,
                            if name == "location" {
                                safe_url(value).unwrap_or_else(|| "[相对跳转地址]".into())
                            } else {
                                value.to_string()
                            },
                        )
                    })
            })
            .collect::<std::collections::BTreeMap<_, _>>(),
        )
        .expect("response headers JSON"),
    );
    result.details.stage = "read_response".into();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        let (_, cause) = network_error(&error);
        result.details.cause = Some(redactor.text(&cause));
        AppError::new("ai_response_body", "已收到 HTTP 响应，但读取响应内容失败。")
    })? {
        if bytes.len() + chunk.len() > 256 * 1024 {
            return Err(AppError::new(
                "ai_response_limit",
                "响应超过测试读取上限（256 KiB），请检查接口是否返回网页或异常数据。",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let parsed = serde_json::from_slice::<Value>(&bytes);
    if let Ok(body) = &parsed
        && let Some(id) = body["request_id"].as_str()
        && result.details.response_headers.get("request-id").is_none()
    {
        result.details.response_headers["request-id"] = json!(redactor.text(id));
    }
    if !(200..300).contains(&status) {
        result.details.stage = "http_error".into();
        result.details.response_error = parsed
            .as_ref()
            .ok()
            .and_then(|body| response_error(body, redactor));
        let message = result
            .details
            .response_error
            .as_ref()
            .and_then(|error| error["message"].as_str())
            .unwrap_or("");
        return Err(AppError::new(
            "ai_http_error",
            format!(
                "HTTP {status} · {}{}",
                status_hint(status),
                if message.is_empty() {
                    String::new()
                } else {
                    format!("\n{message}")
                }
            ),
        ));
    }
    result.details.stage = "parse_response".into();
    let body = parsed.map_err(|_| {
        AppError::new(
            "ai_protocol_error",
            "HTTP 成功，但响应不是 JSON。请检查 API 地址是否指向网页、登录页或错误协议的接口。",
        )
    })?;
    result.details.response_error = response_error(&body, redactor);
    let valid = result.details.response_error.is_none()
        && match provider.kind {
            AiProtocol::Anthropic => body["content"].as_array().is_some_and(|parts| {
                parts.iter().any(|part| {
                    matches!(
                        part["type"].as_str(),
                        Some("text" | "thinking" | "redacted_thinking" | "tool_use")
                    )
                })
            }),
            AiProtocol::Completions => body["choices"]
                .as_array()
                .is_some_and(|choices| choices.iter().any(|choice| choice["message"].is_object())),
            AiProtocol::Responses => body["output"].is_array() && body["status"] != "failed",
        };
    if !valid {
        return Err(AppError::new(
            "ai_protocol_error",
            "HTTP 成功，但响应结构不符合所选协议。请检查接口、模型和协议；若服务返回错误，请查看响应错误详情。",
        ));
    }
    result.details.stage = "complete".into();
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ai::AiProtocol;
    use serde_json::{Value, json};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn connection_probe_uses_each_inference_protocol_and_redacts_errors() {
        for protocol in [
            AiProtocol::Completions,
            AiProtocol::Responses,
            AiProtocol::Anthropic,
        ] {
            for success in [true, false] {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let server = tokio::spawn(async move {
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
                    assert_eq!(body["model"], "probe-model");
                    assert!(
                        body.get("tools")
                            .is_none_or(|tools| tools.as_array().is_some_and(Vec::is_empty))
                    );
                    assert!(body.to_string().contains("Reply with OK only."));
                    let (path, output_limit, response) = match protocol {
                        AiProtocol::Completions => (
                            "chat/completions",
                            body.get("max_completion_tokens")
                                .or_else(|| body.get("max_tokens")),
                            json!({"model":"probe-model","choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}),
                        ),
                        AiProtocol::Responses => (
                            "responses",
                            body.get("max_output_tokens"),
                            json!({"id":"probe","model":"probe-model","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}]}),
                        ),
                        AiProtocol::Anthropic => (
                            "messages",
                            body.get("max_tokens"),
                            json!({"model":"probe-model","role":"assistant","content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}),
                        ),
                    };
                    assert_eq!(output_limit, Some(&json!(1024)));
                    assert!(headers.starts_with(&format!("post /v1/{path} ")));
                    let auth = if protocol == AiProtocol::Anthropic {
                        "x-api-key: synthetic-probe-key"
                    } else {
                        "authorization: bearer synthetic-probe-key"
                    };
                    assert!(headers.contains(auth));
                    let status = if success {
                        "200 OK"
                    } else {
                        "401 Unauthorized"
                    };
                    let response = if success {
                        response
                    } else {
                        json!({"error":{"message":"synthetic-probe-key must never be returned"}})
                    }
                    .to_string();
                    socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).as_bytes()).await.unwrap();
                });
                let provider: AiProviderConfig = serde_json::from_value(json!({
                    "id":"unsaved", "presetId":"custom", "label":"Draft", "baseUrl":format!("http://{address}/v1/"),
                    "apiKey":"synthetic-probe-key", "model":"probe-model", "kind":protocol,
                })).unwrap();
                let result = test_connection(provider).await;
                if success {
                    let result = result.unwrap();
                    assert!(result.success);
                    assert_eq!(result.model, "probe-model");
                    assert!(
                        result
                            .details
                            .api_url
                            .as_deref()
                            .unwrap()
                            .ends_with(match protocol {
                                AiProtocol::Anthropic => "/v1/messages",
                                AiProtocol::Completions => "/v1/chat/completions",
                                AiProtocol::Responses => "/v1/responses",
                            })
                    );
                    assert_eq!(result.details.http_status, Some(200));
                    assert!(
                        !serde_json::to_string(&result)
                            .unwrap()
                            .contains("synthetic-probe-key")
                    );
                } else {
                    let result = result.unwrap();
                    assert!(!result.success);
                    assert_eq!(result.details.http_status, Some(401));
                    assert!(result.message.contains("401"));
                    assert!(
                        !serde_json::to_string(&result)
                            .unwrap()
                            .contains("synthetic-probe-key")
                    );
                    assert!(result.details.response_error.is_some());
                }
                server.await.unwrap();
            }
        }
    }

    fn draft(protocol: AiProtocol, model: &str) -> AiProviderConfig {
        serde_json::from_value(json!({"id":"unsaved", "presetId":"custom", "label":"Draft", "baseUrl":"/v1/messages", "apiKey":"synthetic-probe-key", "model":model, "kind":protocol})).unwrap()
    }

    async fn capture_probe(
        mut provider: AiProviderConfig,
        status: &str,
        response: &str,
        extra_headers: &str,
    ) -> (AiConnectionTestResult, Value, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        provider.base_url = format!("http://{address}{}", provider.base_url);
        let wire_response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nrequest-id: req-probe\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n{response}",
            response.len()
        );
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let header_end = loop {
                let mut chunk = [0; 4096];
                let len = socket.read(&mut chunk).await.unwrap();
                assert!(len > 0);
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
                assert!(len > 0);
                bytes.extend_from_slice(&chunk[..len]);
            }
            let payload = serde_json::from_slice(&bytes[header_end..header_end + size]).unwrap();
            socket.write_all(wire_response.as_bytes()).await.unwrap();
            (payload, headers)
        });
        let result = test_connection(provider).await.unwrap();
        let (payload, headers) = server.await.unwrap();
        (result, payload, headers)
    }

    #[tokio::test]
    async fn legacy_messages_full_endpoint_sends_valid_thinking_and_exact_diagnostics() {
        let mut provider = draft(AiProtocol::Anthropic, "claude-sonnet-4-5-20250929");
        provider.api_key = Some("  synthetic-probe-key  ".into());
        let mut model = AiModelConfig::from_id(provider.model.clone());
        model.reasoning_effort = Some("medium".into());
        model.reasoning_levels = crate::models::ai::default_reasoning_levels();
        provider.models.push(model);
        let (result, payload, headers) = capture_probe(
            provider,
            "200 OK",
            r#"{"content":[{"type":"text","text":"OK"}]}"#,
            "",
        )
        .await;
        assert!(result.success);
        assert!(headers.starts_with("post /v1/messages "));
        assert!(headers.contains("anthropic-version: 2023-06-01"));
        assert!(headers.contains("x-api-key: synthetic-probe-key\r\n"));
        assert_eq!(payload["thinking"]["type"], "enabled");
        assert!(payload["thinking"]["budget_tokens"].as_u64().unwrap() >= 1024);
        assert!(
            payload["thinking"]["budget_tokens"].as_u64().unwrap()
                < payload["max_tokens"].as_u64().unwrap()
        );
        assert!(payload.get("output_config").is_none());
        assert_eq!(result.details.request_body, Some(payload));
        assert_eq!(result.details.response_headers["request-id"], "req-probe");
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("synthetic-probe-key")
        );
    }

    #[tokio::test]
    async fn http_parameter_error_is_specific_and_redacts_server_echoes() {
        let (result, _, _) = capture_probe(draft(AiProtocol::Anthropic,"gateway-alias"), "400 Bad Request", r#"{"error":{"type":"invalid_request_error","message":"adaptive thinking not supported; key synthetic-probe-key"}}"#, "").await;
        assert!(!result.success);
        assert!(result.message.contains("400"));
        assert!(result.message.contains("adaptive thinking"));
        assert_eq!(result.details.stage, "http_error");
        assert_eq!(
            result.details.response_error.unwrap()["type"],
            "invalid_request_error"
        );
        assert!(!result.message.contains("synthetic-probe-key"));
    }

    #[tokio::test]
    async fn non_json_wrong_protocol_and_redirect_responses_do_not_pass() {
        for response in [
            "<html>not an API synthetic-probe-key</html>",
            r#"{"choices":[{"message":{"content":"OK"}}]}"#,
        ] {
            let (result, _, _) =
                capture_probe(draft(AiProtocol::Anthropic, "test"), "200 OK", response, "").await;
            assert!(!result.success);
            assert_eq!(result.details.stage, "parse_response");
            assert_eq!(result.details.http_status, Some(200));
            assert!(
                !serde_json::to_string(&result)
                    .unwrap()
                    .contains("synthetic-probe-key")
            );
        }
        let (redirect, _, _) = capture_probe(draft(AiProtocol::Anthropic,"test"), "302 Found", "{}", "Location: https://user:synthetic-probe-key@unreachable.invalid/login?api_key=synthetic-probe-key\r\n").await;
        assert_eq!(redirect.details.http_status, Some(302));
        assert!(!redirect.success);
        assert_eq!(
            redirect.details.response_headers["location"],
            "https://unreachable.invalid/login"
        );
        assert!(
            !serde_json::to_string(&redirect)
                .unwrap()
                .contains("synthetic-probe-key")
        );
    }

    #[tokio::test]
    async fn network_and_configuration_failures_retain_diagnostic_stage() {
        let mut invalid = draft(AiProtocol::Anthropic, "test");
        invalid.base_url = "not-a-url".into();
        let result = test_connection(invalid).await.unwrap();
        assert!(!result.success);
        assert_eq!(result.details.stage, "validate_config");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let mut provider = draft(AiProtocol::Anthropic, "test");
        provider.base_url = format!("http://{address}/v1/");
        let result = test_connection(provider).await.unwrap();
        assert!(!result.success);
        assert_eq!(result.details.stage, "send_request");
        assert!(result.details.cause.is_some());
        assert!(result.details.http_status.is_none());
        assert!(
            !serde_json::to_string(&result)
                .unwrap()
                .contains("synthetic-probe-key")
        );
    }
}
