//! Model failures retain transport evidence, never full prompts or response dumps.
use std::time::Duration;

use super::diagnostics::{Redactor, network_error, safe_url, status_hint};
use crate::{
    error::AppError,
    models::ai::{AiProtocol, AiProviderConfig},
};
use reqwest::header::HeaderMap;
use serde_json::{Value, json};

pub fn network(error: &reqwest::Error) -> AppError {
    let (kind, cause) = network_error(error);
    let mut result = AppError::new(
        "ai_request_error",
        if kind == "timeout" {
            "模型请求超时。"
        } else {
            "无法连接模型服务。"
        },
    );
    result.details = Some(json!({"errorType":kind,"cause":cause}));
    result
}

pub fn http(status: u16, headers: &HeaderMap, body: &str) -> AppError {
    let mut result = AppError::new(
        "ai_request_error",
        format!("模型请求失败（HTTP {status}）：{}", status_hint(status)),
    );
    let headers: serde_json::Map<String, Value> = [
        "x-request-id",
        "request-id",
        "openai-request-id",
        "cf-ray",
        "retry-after",
        "content-type",
    ]
    .into_iter()
    .filter_map(|name| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(|value| (name.into(), json!(value)))
    })
    .collect();
    // Providers may echo entire prompts alongside an error. Only error fields leave Rust.
    let error = serde_json::from_str::<Value>(body).ok().and_then(|body| {
        let error = body.get("error").unwrap_or(&body);
        if let Some(message) = error.as_str() {
            return Some(json!({"message":message}));
        }
        let fields: serde_json::Map<String, Value> = ["type", "code", "message", "param"]
            .into_iter()
            .filter_map(|name| {
                error
                    .get(name)
                    .filter(|value| value.is_string() || value.is_number())
                    .map(|value| (name.into(), value.clone()))
            })
            .collect();
        (!fields.is_empty()).then_some(Value::Object(fields))
    });
    result.details = Some(
        json!({"errorType":"http", "httpStatus":status, "responseHeaders":headers, "responseError":error,
        "cause": if error.is_none() { Some("服务返回非标准错误响应；未展示可能包含页面或会话内容的完整正文。") } else { None }}),
    );
    result
}

pub fn sdk(error: genai::Error) -> AppError {
    match error {
        genai::Error::WebModelCall { webc_error, .. }
        | genai::Error::WebAdapterCall { webc_error, .. } => match webc_error {
            genai::webc::Error::ResponseFailedStatus {
                status,
                body,
                headers,
            } => http(status.as_u16(), &headers, &body),
            genai::webc::Error::Reqwest(error) => network(&error),
            genai::webc::Error::ResponseFailedNotJson { content_type, .. } => protocol(format!(
                "服务返回了非 JSON 内容（{content_type}），请检查网关地址或登录拦截。"
            )),
            genai::webc::Error::ResponseFailedInvalidJson { cause, .. } => protocol(cause),
            other => protocol(other.to_string()),
        },
        genai::Error::HttpError { status, body, .. } => {
            http(status.as_u16(), &HeaderMap::new(), &body)
        }
        genai::Error::ChatResponseGeneration {
            cause,
            response_body,
            ..
        } => {
            if response_body.get("error").is_some() {
                http(200, &HeaderMap::new(), &response_body.to_string())
            } else {
                protocol(cause)
            }
        }
        // Display for ChatResponse contains a full body. Do not forward it.
        genai::Error::ChatResponse { body, .. } => http(200, &HeaderMap::new(), &body.to_string()),
        other => protocol(other.to_string()),
    }
}

pub fn protocol(cause: impl Into<String>) -> AppError {
    let mut result = AppError::new(
        "ai_protocol_error",
        "模型响应格式无效或输出被截断，请展开查看诊断。",
    );
    result.details = Some(json!({"errorType":"protocol", "cause":cause.into()}));
    result
}

pub fn deadline_timeout(total_budget: bool) -> AppError {
    let mut result = AppError::new("ai_request_error", "等待模型服务响应超时。");
    result.details = Some(json!({
        "errorType": "timeout",
        "cause": if total_budget { "已达到本次模型请求的总等待上限。" } else { "服务未在单次请求时限内返回完整响应。" }
    }));
    result
}

pub struct Retry {
    pub delay: Duration,
    pub timeout: bool,
}

pub fn retry_delay(error: &AppError, attempt: u32, timeout_retried: bool) -> Option<Retry> {
    let details = error.details.as_ref()?;
    let status = details["httpStatus"].as_u64();
    let timeout = details["errorType"] == "timeout" || status == Some(408);
    if timeout && timeout_retried {
        return None;
    }

    let retry_after = details["responseHeaders"].get("retry-after").map(|value| {
        // Wait only for short delta-seconds hints. An unsupported date or longer
        // cooldown should surface the provider error rather than retry too soon.
        value
            .as_str()?
            .trim()
            .parse::<u64>()
            .ok()
            .filter(|seconds| *seconds <= 30)
            .map(Duration::from_secs)
    });
    if status == Some(429) {
        let response = &details["responseError"];
        let quota_exhausted = ["code", "type", "message"].iter().any(|field| {
            let value = response[*field]
                .as_str()
                .unwrap_or_default()
                .to_ascii_lowercase();
            [
                "insufficient_quota",
                "quota_exceeded",
                "billing",
                "insufficient_balance",
                "exceeded your current quota",
                "余额不足",
                "额度用尽",
            ]
            .iter()
            .any(|marker| value.contains(marker))
        });
        if quota_exhausted || retry_after.is_none() {
            return None;
        }
    } else if !timeout && !matches!(status, Some(502 | 503 | 504 | 529)) {
        return None;
    }

    let backoff = Duration::from_secs(u64::from(attempt));
    let delay = match retry_after {
        Some(hint) => backoff.max(hint?),
        None => backoff,
    };
    Some(Retry { delay, timeout })
}

pub fn describe(
    mut error: AppError,
    provider: &AiProviderConfig,
    request: &genai::chat::ChatRequest,
    options: Option<&genai::chat::ChatOptions>,
    elapsed_ms: u128,
    attempts: u32,
) -> AppError {
    let redactor = Redactor::with_values(
        provider.api_key.as_deref(),
        &provider.proxy_url,
        provider
            .extra_headers
            .iter()
            .filter_map(|header| header.value.as_deref()),
    );
    let suffix = match provider.kind {
        AiProtocol::Completions => "chat/completions",
        AiProtocol::Responses => "responses",
        AiProtocol::Anthropic => "messages",
    };
    let url = super::providers::endpoint(provider)
        .ok()
        .and_then(|base| safe_url(&format!("{base}{suffix}")));
    let mut details = error
        .details
        .take()
        .unwrap_or_else(|| json!({"errorType":error.code,"cause":error.message}));
    details["protocol"] = json!(provider.kind);
    details["model"] = json!(provider.model);
    details["apiUrl"] = json!(url);
    details["method"] = json!("POST");
    details["elapsedMs"] = json!(elapsed_ms);
    details["attempts"] = json!(attempts);
    details["request"] = json!({"messageCount": request.messages.len(), "toolCount":request.tools.as_ref().map_or(0, Vec::len),
        "configuredContextWindow":provider.models.iter().find(|model| model.id == provider.model).map_or(crate::models::ai::DEFAULT_MODEL_CONTEXT_WINDOW, |model| model.context_window),
        "estimatedInputTokens":super::context::request_tokens(request), "maxOutputTokens":options.and_then(|options| options.max_tokens),
        "parameters":options.and_then(|options| options.extra_body.as_ref()), "extraHeaderNames":provider.extra_headers.iter().map(|header| &header.name).collect::<Vec<_>>()});
    error.message = redactor.text(&error.message);
    error.details = Some(redactor.value(&details));
    error
}

pub fn context_overflow(error: &AppError) -> bool {
    let Some(details) = &error.details else {
        return false;
    };
    if !matches!(details["httpStatus"].as_u64(), Some(400 | 413 | 422)) {
        return false;
    }
    let code = details["responseError"]["code"]
        .as_str()
        .unwrap_or_default();
    let message = details["responseError"]["message"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    code == "context_length_exceeded"
        || [
            "maximum context length",
            "context window",
            "prompt is too long",
            "input is too long",
        ]
        .iter()
        .any(|marker| message.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::client::build_client;
    use genai::chat::{ChatOptions, ChatRequest};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn retries_respect_busy_hints_and_do_not_replay_permanent_failures() {
        for (status, hint, code, expected) in [
            (503, None, "", Some(2)),
            (503, Some("5"), "", Some(5)),
            (503, Some("60"), "", None),
            (429, Some("4"), "rate_limit_exceeded", Some(4)),
            (429, Some("4"), "insufficient_quota", None),
            (429, None, "rate_limit_exceeded", None),
            (429, Some("Wed, 11 Nov 2026 08:00:00 GMT"), "", None),
            (401, Some("4"), "", None),
            (400, None, "", None),
        ] {
            let mut headers = HeaderMap::new();
            if let Some(hint) = hint {
                headers.insert("retry-after", hint.parse().unwrap());
            }
            let error = http(
                status,
                &headers,
                &json!({"error":{"code":code}}).to_string(),
            );
            assert_eq!(
                retry_delay(&error, 2, false).map(|retry| retry.delay.as_secs()),
                expected
            );
        }
        for error in [deadline_timeout(false), http(408, &HeaderMap::new(), "")] {
            assert!(retry_delay(&error, 1, false).is_some_and(|retry| retry.timeout));
            assert!(retry_delay(&error, 2, true).is_none());
        }
    }

    #[test]
    fn long_echoed_header_is_redacted_before_diagnostic_truncation() {
        let secret = "long-gateway-token-".repeat(400);
        let provider: AiProviderConfig = serde_json::from_value(json!({"id":"runtime", "label":"test", "baseUrl":"https://test.invalid/v1/", "model":"test", "extraHeaders":[{"id":"header", "name":"X-Token", "value":secret}]})).unwrap();
        let error = http(
            401,
            &HeaderMap::new(),
            &json!({"error":{"message":secret}}).to_string(),
        );
        let error = describe(
            error,
            &provider,
            &ChatRequest::from_user("test"),
            None,
            10,
            1,
        );
        assert!(
            !serde_json::to_string(&error)
                .unwrap()
                .contains("long-gateway-token-")
        );
    }

    #[test]
    fn context_recovery_only_matches_explicit_overflow_not_other_bad_requests() {
        for (status, code, message, expected) in [
            (400, "context_length_exceeded", "", true),
            (
                400,
                "invalid_request_error",
                "prompt is too long: 140000 tokens",
                true,
            ),
            (
                400,
                "invalid_request_error",
                "thinking parameter unsupported",
                false,
            ),
            (401, "context_length_exceeded", "", false),
            (429, "insufficient_quota", "", false),
        ] {
            let error = http(
                status,
                &HeaderMap::new(),
                &json!({"error":{"code":code,"message":message}}).to_string(),
            );
            assert_eq!(context_overflow(&error), expected);
        }
    }

    #[test]
    fn sdk_parse_error_excludes_full_request_and_response() {
        let error = sdk(genai::Error::ChatResponseGeneration {
            model_iden: genai::ModelIden::new(genai::adapter::AdapterKind::OpenAI, "test"),
            request_payload: Box::new(json!({"messages":"private prompt"})),
            response_body: Box::new(json!({"unknown":"private response"})),
            cause: "invalid function arguments JSON".into(),
        });
        let text = serde_json::to_string(&error).unwrap();
        assert!(text.contains("invalid function arguments JSON"));
        assert!(!text.contains("private prompt"));
        assert!(!text.contains("private response"));
    }

    #[tokio::test]
    async fn runtime_failures_preserve_status_and_redacted_errors_for_all_protocols() {
        for protocol in [
            AiProtocol::Completions,
            AiProtocol::Responses,
            AiProtocol::Anthropic,
        ] {
            for status in [200, 400, 401, 429, 503] {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let attempts = if status == 503 { 3 } else { 1 };
                let server = tokio::spawn(async move {
                    for _ in 0..attempts {
                        let (mut socket, _) = listener.accept().await.unwrap();
                        let mut bytes = Vec::new();
                        loop {
                            let mut chunk = [0; 4096];
                            let count = socket.read(&mut chunk).await.unwrap();
                            assert_ne!(count, 0);
                            bytes.extend_from_slice(&chunk[..count]);
                            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n")
                            {
                                let headers =
                                    String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                                let length = headers
                                    .lines()
                                    .find_map(|line| line.strip_prefix("content-length:"))
                                    .unwrap()
                                    .trim()
                                    .parse::<usize>()
                                    .unwrap();
                                if bytes.len() >= end + 4 + length {
                                    break;
                                }
                            }
                        }
                        let body = json!({"error":{"type":"invalid_request_error","code":"context_length_exceeded", "message":"original provider error: runtime-api-secret runtime-header-secret"}, "messages":"private prompt echo"}).to_string();
                        socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nX-Request-Id: diagnostic-id\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                    }
                });
                let provider: AiProviderConfig = serde_json::from_value(json!({"id":"runtime", "label":"test", "presetId":"custom", "baseUrl":format!("http://{address}/gateway/v1/"), "model":"test", "kind":protocol,
                    "apiKey":"runtime-api-secret", "extraHeaders":[{"id":"token", "name":"X-Gateway-Token", "value":"runtime-header-secret"}]})).unwrap();
                let client = build_client(&provider).unwrap();
                let error = client
                    .exec_chat(
                        "test",
                        ChatRequest::from_user("private prompt"),
                        Some(&ChatOptions::default().with_max_tokens(32)),
                    )
                    .await
                    .unwrap_err();
                let details = error.details.as_ref().unwrap();
                assert_eq!(details["httpStatus"], status);
                assert_eq!(details["attempts"], attempts);
                // genai exposes headers on HTTP failures, not successful HTTP 200 envelopes.
                if status != 200 || protocol == AiProtocol::Anthropic {
                    assert_eq!(details["responseHeaders"]["x-request-id"], "diagnostic-id");
                }
                assert_eq!(details["request"]["messageCount"], 1);
                assert_eq!(details["request"]["maxOutputTokens"], 32);
                assert!(details["apiUrl"].as_str().unwrap().contains("/gateway/v1/"));
                let text = serde_json::to_string(&error).unwrap();
                assert!(text.contains("original provider error"));
                for secret in [
                    "runtime-api-secret",
                    "runtime-header-secret",
                    "private prompt",
                ] {
                    assert!(!text.contains(secret));
                }
                server.await.unwrap();
            }
        }
    }
}
