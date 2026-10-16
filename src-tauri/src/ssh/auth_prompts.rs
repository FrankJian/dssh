//! One-shot keyboard-interactive authentication prompts.
//!
//! SSH servers use keyboard-interactive authentication for OTP/MFA challenges.
//! The challenge text is emitted to the UI, while responses are kept only long
//! enough to deliver them to the active `russh` authentication exchange.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
};

pub const SSH_AUTH_PROMPT_EVENT: &str = "ssh://auth-prompt";
const SSH_AUTH_PROMPT_CLOSED_EVENT: &str = "ssh://auth-prompt-closed";
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
    profile_id: String,
    host: String,
    port: u16,
    username: String,
    name: String,
    instructions: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_message: Option<String>,
    prompts: Vec<SshAuthPromptField>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAuthPromptField {
    prompt: String,
    echo: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAuthPromptClosedEvent {
    prompt_id: String,
}

/// Also runs when the authentication future is dropped (for example when
/// the server disconnects while the user is entering a code).
struct PendingPromptGuard<'a, F: Fn(&str)> {
    state: &'a Mutex<PromptState>,
    prompt_id: String,
    on_close: F,
}

impl<F: Fn(&str)> Drop for PendingPromptGuard<'_, F> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.pending.remove(&self.prompt_id);
        }
        (self.on_close)(&self.prompt_id);
    }
}

struct PendingPrompt {
    profile_id: String,
    expected_responses: usize,
    sender: oneshot::Sender<Option<Vec<String>>>,
}

#[derive(Default)]
struct PromptState {
    pending: HashMap<String, PendingPrompt>,
    cancelled_profiles: HashSet<String>,
}

impl PromptState {
    fn begin_profile_attempt(&mut self, profile_id: &str) {
        self.cancelled_profiles.remove(profile_id);
    }

    fn cancel_profile(&mut self, profile_id: &str) -> Vec<PendingPrompt> {
        self.cancelled_profiles.insert(profile_id.to_string());
        let prompt_ids = self
            .pending
            .iter()
            .filter(|(_, prompt)| prompt.profile_id == profile_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        prompt_ids
            .into_iter()
            .filter_map(|id| self.pending.remove(&id))
            .collect()
    }
}

pub struct SshAuthPromptManager {
    app_handle: AppHandle,
    state: Mutex<PromptState>,
    counter: AtomicU64,
}

impl SshAuthPromptManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            state: Mutex::new(PromptState::default()),
            counter: AtomicU64::new(1),
        }
    }

    pub async fn request(
        &self,
        profile: &SshProfile,
        name: String,
        instructions: String,
        retry_message: Option<String>,
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
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| AppError::new("auth_prompt_error", "无法创建 SSH 认证提示。"))?;
            if state.cancelled_profiles.contains(&profile.id) {
                return Err(AppError::new(
                    "auth_prompt_cancelled",
                    "SSH 多因子认证已取消。",
                ));
            }
            state.pending.insert(
                prompt_id.clone(),
                PendingPrompt {
                    profile_id: profile.id.clone(),
                    expected_responses: prompts.len(),
                    sender,
                },
            );
        }

        let _guard = PendingPromptGuard {
            state: &self.state,
            prompt_id: prompt_id.clone(),
            on_close: |id: &str| self.emit_closed(id),
        };
        let event = SshAuthPromptEvent {
            prompt_id: prompt_id.clone(),
            profile_id: profile.id.clone(),
            host: profile.host.clone(),
            port: profile.port,
            username: profile.username.clone(),
            name,
            instructions,
            retry_message,
            prompts: prompts
                .into_iter()
                .map(|prompt| SshAuthPromptField {
                    prompt: prompt.prompt,
                    echo: prompt.echo,
                })
                .collect(),
        };
        if self.app_handle.emit(SSH_AUTH_PROMPT_EVENT, event).is_err() {
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
            _ => Err(AppError::new(
                "auth_prompt_timeout",
                "SSH 多因子认证输入已超时。",
            )),
        }
    }

    pub fn respond(&self, prompt_id: &str, responses: Option<Vec<String>>) -> AppResult<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::new("auth_prompt_error", "无法提交 SSH 认证输入。"))?;
        let Some(pending) = state.pending.get(prompt_id) else {
            drop(state);
            self.emit_closed(prompt_id);
            return Err(AppError::new(
                "auth_prompt_not_found",
                "该 SSH 认证请求已失效。",
            ));
        };
        let expected = pending.expected_responses;

        if let Some(values) = responses.as_ref() {
            validate_responses(expected, values)?;
        }

        let profile_id = state
            .pending
            .get(prompt_id)
            .map(|prompt| prompt.profile_id.clone())
            .ok_or_else(|| AppError::new("auth_prompt_not_found", "该 SSH 认证请求已失效。"))?;
        let prompts = if responses.is_none() {
            state.cancel_profile(&profile_id)
        } else {
            state.pending.remove(prompt_id).into_iter().collect()
        };
        drop(state);
        for prompt in prompts {
            if prompt.sender.send(responses.clone()).is_err() && responses.is_some() {
                self.emit_closed(prompt_id);
                return Err(AppError::new(
                    "auth_prompt_not_found",
                    "该 SSH 认证请求已失效。",
                ));
            }
        }
        Ok(())
    }

    fn emit_closed(&self, prompt_id: &str) {
        let _ = self.app_handle.emit(
            SSH_AUTH_PROMPT_CLOSED_EVENT,
            SshAuthPromptClosedEvent {
                prompt_id: prompt_id.to_string(),
            },
        );
    }

    /// Clear cancellation only when the pool starts a new user-initiated
    /// transport handshake; background reconnects must preserve it.
    pub fn begin_profile_attempt(&self, profile_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.begin_profile_attempt(profile_id);
        }
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

    #[tokio::test]
    async fn expired_prompt_is_removed_without_closing_replacement() {
        let state = Mutex::new(PromptState::default());
        let closed = Mutex::new(Vec::new());
        let (old_tx, mut old_rx) = oneshot::channel();
        let (new_tx, mut new_rx) = oneshot::channel();
        for (id, sender) in [("expired", old_tx), ("replacement", new_tx)] {
            state.lock().unwrap().pending.insert(
                id.into(),
                PendingPrompt {
                    profile_id: "profile-a".into(),
                    expected_responses: 1,
                    sender,
                },
            );
        }
        // Dropping the waiting future happens both on an input deadline and
        // when the transport branch of select! finishes first.
        let result = tokio::time::timeout(Duration::from_millis(1), async {
            let _guard = PendingPromptGuard {
                state: &state,
                prompt_id: "expired".into(),
                on_close: |id: &str| closed.lock().unwrap().push(id.to_string()),
            };
            std::future::pending::<()>().await;
        })
        .await;
        assert!(result.is_err());
        assert!(!state.lock().unwrap().pending.contains_key("expired"));
        assert!(state.lock().unwrap().pending.contains_key("replacement"));
        assert_eq!(*closed.lock().unwrap(), vec!["expired"]);
        assert!(matches!(
            old_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
        assert!(matches!(
            new_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));

        let pending = state.lock().unwrap().pending.remove("replacement").unwrap();
        assert!(
            pending
                .sender
                .send(Some(vec!["test-response".into()]))
                .is_ok()
        );
        assert_eq!(new_rx.await.unwrap(), Some(vec!["test-response".into()]));
    }

    #[tokio::test]
    async fn successful_response_also_closes_its_dialog() {
        let state = Mutex::new(PromptState::default());
        let closed = Mutex::new(Vec::new());
        let (sender, receiver) = oneshot::channel();
        state.lock().unwrap().pending.insert(
            "active".into(),
            PendingPrompt {
                profile_id: "profile-a".into(),
                expected_responses: 1,
                sender,
            },
        );
        {
            let _guard = PendingPromptGuard {
                state: &state,
                prompt_id: "active".into(),
                on_close: |id: &str| closed.lock().unwrap().push(id.to_string()),
            };
            let pending = state.lock().unwrap().pending.remove("active").unwrap();
            assert!(
                pending
                    .sender
                    .send(Some(vec!["test-response".into()]))
                    .is_ok()
            );
            assert_eq!(receiver.await.unwrap(), Some(vec!["test-response".into()]));
        }
        assert!(state.lock().unwrap().pending.is_empty());
        assert_eq!(*closed.lock().unwrap(), vec!["active"]);
    }

    #[test]
    fn cancellation_clears_all_prompts_for_profile_until_a_new_attempt() {
        let mut state = PromptState::default();
        let (first_tx, mut first_rx) = oneshot::channel();
        let (second_tx, mut second_rx) = oneshot::channel();
        let (other_tx, mut other_rx) = oneshot::channel();
        state.pending.insert(
            "first".into(),
            PendingPrompt {
                profile_id: "profile-a".into(),
                expected_responses: 1,
                sender: first_tx,
            },
        );
        state.pending.insert(
            "second".into(),
            PendingPrompt {
                profile_id: "profile-a".into(),
                expected_responses: 1,
                sender: second_tx,
            },
        );
        state.pending.insert(
            "other".into(),
            PendingPrompt {
                profile_id: "profile-b".into(),
                expected_responses: 1,
                sender: other_tx,
            },
        );

        for prompt in state.cancel_profile("profile-a") {
            let _ = prompt.sender.send(None);
        }

        assert!(state.cancelled_profiles.contains("profile-a"));
        assert!(!state.pending.contains_key("first"));
        assert!(!state.pending.contains_key("second"));
        assert!(state.pending.contains_key("other"));
        assert!(matches!(first_rx.try_recv(), Ok(None)));
        assert!(matches!(second_rx.try_recv(), Ok(None)));
        assert!(other_rx.try_recv().is_err());

        state.begin_profile_attempt("profile-a");
        assert!(!state.cancelled_profiles.contains("profile-a"));
    }
}
