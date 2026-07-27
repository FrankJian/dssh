use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use tokio::sync::{Mutex as AsyncMutex, Notify, mpsc};

pub mod agent;
pub mod client;
pub mod copilot;
pub mod tools;

pub use agent::run_agent;

use copilot::CopilotSession;

/// A user decision on a pending tool call.
#[derive(Debug, Clone)]
pub struct ApprovalDecision {
    pub call_id: String,
    pub approved: bool,
}

/// A selection submitted through the agent's interactive question tool.
#[derive(Debug, Clone)]
pub struct QuestionAnswer {
    pub call_id: String,
    pub option_ids: Vec<String>,
}

/// Shared control channel for a single in-flight agent run.
struct RunControl {
    approval_tx: mpsc::UnboundedSender<ApprovalDecision>,
    question_tx: mpsc::UnboundedSender<QuestionAnswer>,
    cancel: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
}

/// Handles handed to the running agent task so it can await approvals and
/// observe cancellation.
pub struct RunHandles {
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
    /// Cached short-lived Copilot session token (resolved from the stored
    /// GitHub token). Guarded by an async mutex so refreshes are serialized.
    pub(crate) copilot_session: Arc<AsyncMutex<Option<CopilotSession>>>,
    /// Set while a Copilot device-login poll is running; also used to cancel it.
    pub(crate) copilot_login_active: Arc<std::sync::atomic::AtomicBool>,
}

impl std::fmt::Debug for RunControl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunControl").finish()
    }
}

impl AiManager {
    /// Register a new run and return the handles the agent task should hold.
    pub fn register_run(&self, run_id: &str) -> RunHandles {
        let (approval_tx, approval_rx) = mpsc::unbounded_channel();
        let (question_tx, question_rx) = mpsc::unbounded_channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_notify = Arc::new(Notify::new());

        if let Ok(mut runs) = self.runs.lock() {
            runs.insert(
                run_id.to_string(),
                RunControl {
                    approval_tx,
                    question_tx,
                    cancel: cancel.clone(),
                    cancel_notify: cancel_notify.clone(),
                },
            );
        }

        RunHandles {
            approval_rx,
            question_rx,
            cancel,
            cancel_notify,
        }
    }

    /// Deliver an approval/rejection decision to a waiting run.
    pub fn approve(&self, run_id: &str, call_id: &str, approved: bool) {
        if let Ok(runs) = self.runs.lock()
            && let Some(control) = runs.get(run_id)
        {
            let _ = control.approval_tx.send(ApprovalDecision {
                call_id: call_id.to_string(),
                approved,
            });
        }
    }

    /// Deliver selected option ids for an interactive question.
    pub fn answer_question(&self, run_id: &str, call_id: &str, option_ids: Vec<String>) {
        if let Ok(runs) = self.runs.lock()
            && let Some(control) = runs.get(run_id)
        {
            let _ = control.question_tx.send(QuestionAnswer {
                call_id: call_id.to_string(),
                option_ids,
            });
        }
    }

    /// Request cancellation of a run.
    pub fn cancel(&self, run_id: &str) {
        if let Ok(runs) = self.runs.lock()
            && let Some(control) = runs.get(run_id)
        {
            control.cancel.store(true, Ordering::SeqCst);
            control.cancel_notify.notify_waiters();
            control.cancel_notify.notify_one();
        }
    }

    /// Remove a run once its task has finished.
    pub fn finish_run(&self, run_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.remove(run_id);
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
