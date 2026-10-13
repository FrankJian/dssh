//! One-shot keyboard-interactive authentication prompts.
//!
//! SSH servers use keyboard-interactive authentication for OTP/MFA challenges.
//! The challenge text is emitted to the UI, while responses are kept only long
//! enough to deliver them to the active `russh` authentication exchange.

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::error::{AppError, AppResult};

pub const SSH_AUTH_PROMPT_EVENT: &str = "ssh://auth-prompt";
const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_PROMPTS_PER_ROUND: usize = 8;
const MAX_RESPONSE_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone)]
pub struct SshAuthPrompt {
    pub prompt: String,
    pub echo: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAuthPromptEvent {
    prompt_id: String,
    host: String,
    port: u16,
    username: String,
    name: String,
    instructions: String,
    prompts: Vec<SshAuthPromptField>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAuthPromptField {
    prompt: String,
    echo: bool,
}

struct PendingPrompt {
    expected_responses: usize,
    sender: oneshot::Sender<Option<Vec<String>>>,
}

pub struct SshAuthPromptManager {
    app_handle: AppHandle,
    pending: Mutex<HashMap<String, PendingPrompt>>,
    counter: AtomicU64,
}

impl SshAuthPromptManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            pending: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
        }
    }

    pub async fn request(
        &self,
        host: &str,
        port: u16,
        username: &str,
        name: String,
        instructions: String,
        prompts: Vec<SshAuthPrompt>,
    ) -> AppResult<Vec<String>> {
        if prompts.len() > MAX_PROMPTS_PER_ROUND {
            return Err(AppError::new(
                "auth_prompt_invalid",
                "SSH 服务器一次请求了过多的认证输入。",
            ));
        }

        let prompt_id = format!("ssh-auth-{}", self.counter.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| AppError::new("auth_prompt_error", "无法创建 SSH 认证提示。"))?
            .insert(
                prompt_id.clone(),
                PendingPrompt {
                    expected_responses: prompts.len(),
                    sender,
                },
            );

        let event = SshAuthPromptEvent {
            prompt_id: prompt_id.clone(),
            host: host.to_string(),
            port,
            username: username.to_string(),
            name,
            instructions,
            prompts: prompts
                .into_iter()
                .map(|prompt| SshAuthPromptField {
                    prompt: prompt.prompt,
                    echo: prompt.echo,
                })
                .collect(),
        };
        if self.app_handle.emit(SSH_AUTH_PROMPT_EVENT, event).is_err() {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&prompt_id);
            }
            return Err(AppError::new(
                "auth_prompt_error",
                "无法显示 SSH 多因子认证提示。",
            ));
        }

        match tokio::time::timeout(PROMPT_TIMEOUT, receiver).await {
            Ok(Ok(Some(responses))) => Ok(responses),
            Ok(Ok(None)) => Err(AppError::new(
                "auth_prompt_cancelled",
                "SSH 多因子认证已取消。",
            )),
            _ => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&prompt_id);
                }
                Err(AppError::new(
                    "auth_prompt_timeout",
                    "SSH 多因子认证输入已超时。",
                ))
            }
        }
    }

    pub fn respond(&self, prompt_id: &str, responses: Option<Vec<String>>) -> AppResult<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::new("auth_prompt_error", "无法提交 SSH 认证输入。"))?;
        let expected = pending
            .get(prompt_id)
            .map(|prompt| prompt.expected_responses)
            .ok_or_else(|| AppError::new("auth_prompt_not_found", "该 SSH 认证请求已失效。"))?;

        if let Some(values) = responses.as_ref() {
            validate_responses(expected, values)?;
        }

        let prompt = pending
            .remove(prompt_id)
            .ok_or_else(|| AppError::new("auth_prompt_not_found", "该 SSH 认证请求已失效。"))?;
        let _ = prompt.sender.send(responses);
        Ok(())
    }
}

fn validate_responses(expected: usize, responses: &[String]) -> AppResult<()> {
    if responses.len() != expected {
        return Err(AppError::new(
            "auth_prompt_invalid",
            "SSH 认证输入数量与服务器请求不一致。",
        ));
    }
    if responses
        .iter()
        .any(|response| response.len() > MAX_RESPONSE_BYTES)
    {
        return Err(AppError::new("auth_prompt_invalid", "SSH 认证输入过长。"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_response_count_and_size() {
        assert!(validate_responses(2, &["password".into(), "123456".into()]).is_ok());
        assert!(validate_responses(2, &["123456".into()]).is_err());
        assert!(validate_responses(1, &["x".repeat(MAX_RESPONSE_BYTES + 1)]).is_err());
    }
}
