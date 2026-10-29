use genai::chat::{ChatMessage, ChatOptions, ChatRequest};
use serde::Serialize;
use std::time::{Duration, Instant};

use crate::{
    error::{AppError, AppResult},
    models::ai::{AiModelConfig, AiProviderConfig},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    pub model: String,
    pub elapsed_ms: u64,
}

/// Exercise the actual inference protocol without persisting the draft or chat history.
pub async fn test_connection(mut provider: AiProviderConfig) -> AppResult<AiConnectionTestResult> {
    super::providers::resolve_preset(&mut provider)?;
    provider.model = provider.model.trim().to_string();
    if provider.model.is_empty() {
        return Err(AppError::new(
            "ai_config_error",
            "请先添加并选择默认模型，再测试连接。",
        ));
    }
    let model = provider
        .models
        .iter()
        .find(|model| model.id == provider.model)
        .cloned()
        .unwrap_or_else(|| AiModelConfig::from_id(provider.model.clone()));
    let mut options =
        ChatOptions::default().with_max_tokens(model.max_output_tokens.clamp(1, 1024));
    super::reasoning::apply(
        &mut options,
        provider.kind,
        provider.preset_id.as_deref(),
        &model,
        None,
    )?;
    let client = super::client::build_client(&provider)?;
    let started = Instant::now();
    tokio::time::timeout(
        Duration::from_secs(30),
        client.exec_chat(
            &provider.model,
            ChatRequest::new(vec![ChatMessage::user("Reply with OK only.")]),
            Some(&options),
        ),
    )
    .await
    .map_err(|_| {
        AppError::new(
            "ai_connection_timeout",
            "连接测试超时（30 秒），请检查网络、代理与 API 地址。",
        )
    })?
    .map_err(|_| {
        AppError::new(
            "ai_connection_error",
            "连接测试失败，请检查网络、API 地址、协议、密钥及默认模型配置。",
        )
    })?;
    Ok(AiConnectionTestResult {
        model: provider.model,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
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
                    assert_eq!(result.model, "probe-model");
                    assert!(
                        !serde_json::to_string(&result)
                            .unwrap()
                            .contains("synthetic-probe-key")
                    );
                } else {
                    let error = result.err().unwrap();
                    assert_eq!(error.code, "ai_connection_error");
                    assert!(!error.message.contains("synthetic-probe-key"));
                }
                server.await.unwrap();
            }
        }
    }
}
