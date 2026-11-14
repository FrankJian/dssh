use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use tokio::sync::{Notify, mpsc};

use crate::error::{AppError, AppResult};

pub mod agent;
mod anthropic;
pub mod background;
pub mod client;
pub mod connection;
mod context;
pub(crate) mod diagnostics;
mod failure;
pub mod headers;
mod output_wait;
pub mod providers;
mod reasoning;
mod terminal;
pub mod tools;

pub use agent::run_agent;

/// A user decision on a pending tool call.
#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub call_id: String,
    pub approved: bool,
}

/// An answer submitted through the agent's interactive question tool.
#[derive(Debug, Clone)]
pub struct QuestionAnswer {
    pub call_id: String,
    pub option_ids: Vec<String>,
    pub custom_text: Option<String>,
}

/// Shared control channel for a single in-flight agent run.
struct RunControl {
    conversation_id: String,
    owner: String,
    approval_tx: mpsc::UnboundedSender<ApprovalDecision>,
    question_tx: mpsc::UnboundedSender<QuestionAnswer>,
    cancel: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
}

/// Handles handed to the running agent task so it can await approvals and
/// observe cancellation.
pub struct RunHandles {
    manager: AiManager,
    run_id: String,
    pub approval_rx: mpsc::UnboundedReceiver<ApprovalDecision>,
    pub question_rx: mpsc::UnboundedReceiver<QuestionAnswer>,
    pub cancel: Arc<AtomicBool>,
    pub cancel_notify: Arc<Notify>,
}

/// Tracks running agent tasks so the frontend can approve tool calls or cancel
/// runs mid-flight.
#[derive(Debug, Clone, Default)]
pub struct AiManager {
    runs: Arc<Mutex<HashMap<String, RunControl>>>,
    /// Cache of chunk-level history summaries, keyed by a hash of the raw chunk
    /// text. Older chunks are stable as a conversation grows, so this keeps
    /// history compaction cheap (only newly-dropped turns get summarized).
    summaries: Arc<Mutex<HashMap<u64, String>>>,
}

impl std::fmt::Debug for RunControl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunControl").finish()
    }
}

impl RunControl {
    fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        self.cancel_notify.notify_waiters();
        self.cancel_notify.notify_one();
    }
}

impl AiManager {
    /// Register a new run and return the handles the agent task should hold.
    pub fn reserve_conversation(
        &self,
        owner: &str,
        conversation_id: &str,
        run_id: &str,
    ) -> AppResult<RunHandles> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| AppError::new("ai_run", "无法启动 AI 会话。"))?;
        if runs.contains_key(run_id)
            || runs
                .values()
                .any(|run| run.conversation_id == conversation_id)
        {
            return Err(AppError::new("ai_run", "此会话已有任务在运行。"));
        }
        let (approval_tx, approval_rx) = mpsc::unbounded_channel();
        let (question_tx, question_rx) = mpsc::unbounded_channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());

        runs.insert(
            run_id.to_string(),
            RunControl {
                conversation_id: conversation_id.to_string(),
                owner: owner.to_string(),
                approval_tx,
                question_tx,
                cancel: cancel.clone(),
                cancel_notify: cancel_notify.clone(),
            },
        );
        Ok(RunHandles {
            manager: self.clone(),
            run_id: run_id.to_string(),
            approval_rx,
            question_rx,
            cancel,
            cancel_notify,
        })
    }

    /// Deliver an approval/rejection decision to a waiting run.
    pub fn approve(&self, owner: &str, run_id: &str, call_id: &str, approved: bool) {
        if let Ok(runs) = self.runs.lock()
            && let Some(control) = runs.get(run_id).filter(|run| run.owner == owner)
        {
            let _ = control.approval_tx.send(ApprovalDecision {
                call_id: call_id.to_string(),
                approved,
            });
        }
    }

    /// Deliver an answer for an interactive question.
    pub fn answer_question(
        &self,
        owner: &str,
        run_id: &str,
        call_id: &str,
        option_ids: Vec<String>,
        custom_text: Option<String>,
    ) {
        if let Ok(runs) = self.runs.lock()
            && let Some(control) = runs.get(run_id).filter(|run| run.owner == owner)
        {
            let _ = control.question_tx.send(QuestionAnswer {
                call_id: call_id.to_string(),
                option_ids,
                custom_text,
            });
        }
    }

    /// Request cancellation of a run.
    pub fn cancel(&self, owner: &str, run_id: &str) {
        if let Ok(runs) = self.runs.lock()
            && let Some(control) = runs.get(run_id).filter(|run| run.owner == owner)
        {
            control.cancel();
        }
    }

    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(runs) = self.runs.lock() {
            for run in runs.values().filter(|run| run.owner == owner) {
                run.cancel();
            }
        }
    }

    /// Look up a previously-computed summary for a history chunk.
    pub fn cached_summary(&self, key: u64) -> Option<String> {
        self.summaries
            .lock()
            .ok()
            .and_then(|map| map.get(&key).cloned())
    }

    /// Store a chunk summary, bounding the cache so it can't grow unbounded.
    pub fn store_summary(&self, key: u64, summary: String) {
        if let Ok(mut map) = self.summaries.lock() {
            if map.len() >= 512 {
                map.clear();
            }
            map.insert(key, summary);
        }
    }
}

impl Drop for RunHandles {
    fn drop(&mut self) {
        if let Ok(mut runs) = self.manager.runs.lock() {
            runs.remove(&self.run_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_keep_approvals_answers_and_cancellation_separate() {
        let manager = AiManager::default();
        let mut a = manager
            .reserve_conversation("main", "session-a", "run-a")
            .unwrap();
        let mut b = manager
            .reserve_conversation("main", "session-b", "run-b")
            .unwrap();
        assert!(
            manager
                .reserve_conversation("main", "session-a", "another-run")
                .is_err()
        );
        assert!(
            manager
                .reserve_conversation("main", "session-c", "run-a")
                .is_err()
        );
        manager.approve("other-window", "run-a", "shared-call", true);
        assert!(a.approval_rx.try_recv().is_err());
        manager.approve("main", "run-a", "shared-call", true);
        assert!(a.approval_rx.try_recv().unwrap().approved);
        assert!(b.approval_rx.try_recv().is_err());
        manager.answer_question("main", "run-b", "shared-call", vec!["pick".into()], None);
        assert!(a.question_rx.try_recv().is_err());
        assert_eq!(b.question_rx.try_recv().unwrap().option_ids, ["pick"]);
        let mut custom: crate::models::ai::AiAnswerQuestionRequest =
            serde_json::from_value(serde_json::json!({
                "runId": "run-a", "callId": "shared-call",
                "customText": "  请连接另一台服务器\n先确认目标  "
            }))
            .unwrap();
        custom.validate_answer().unwrap();
        manager.answer_question(
            "main",
            &custom.run_id,
            &custom.call_id,
            custom.option_ids,
            custom.custom_text,
        );
        assert!(b.question_rx.try_recv().is_err());
        let answer = a.question_rx.try_recv().unwrap();
        assert!(answer.option_ids.is_empty());
        assert_eq!(
            answer.custom_text.as_deref(),
            Some("请连接另一台服务器\n先确认目标")
        );
        manager.cancel("other-window", "run-a");
        assert!(!a.cancel.load(Ordering::SeqCst));
        manager.cancel("main", "run-a");
        assert!(a.cancel.load(Ordering::SeqCst));
        assert!(!b.cancel.load(Ordering::SeqCst));
        drop(a);
        assert!(
            manager
                .reserve_conversation("main", "session-a", "new-run")
                .is_ok()
        );
    }
}
