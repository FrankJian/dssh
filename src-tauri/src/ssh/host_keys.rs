//! Trust-on-first-use (TOFU) host-key verification. Replaces the old
//! "accept any key" behavior: the first time a host key is seen the user is
//! asked to confirm its fingerprint (persisted to `known_hosts.json`), matching
//! keys connect silently, and a changed key is rejected with a warning event.
//!
//! Prompts are coalesced per `host:port`, so several connections racing to the
//! same new host raise a single dialog whose answer applies to all of them.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

const HOSTKEY_PROMPT_EVENT: &str = "ssh://hostkey-prompt";
const HOSTKEY_CHANGED_EVENT: &str = "ssh://hostkey-changed";
/// If the UI never answers, treat the prompt as declined rather than hanging.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyPromptEvent {
    prompt_id: String,
    host: String,
    port: u16,
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyChangedEvent {
    host: String,
    port: u16,
    stored_fingerprint: String,
    presented_fingerprint: String,
}

struct PendingPrompt {
    fingerprint: String,
    waiters: Vec<oneshot::Sender<bool>>,
}

pub struct HostKeyVerifier {
    path: PathBuf,
    entries: Mutex<HashMap<String, String>>,
    pending: Mutex<HashMap<String, PendingPrompt>>,
    app_handle: AppHandle,
    counter: AtomicU64,
}

impl HostKeyVerifier {
    pub fn initialize(app_data_dir: impl AsRef<Path>, app_handle: AppHandle) -> Self {
        let path = app_data_dir.as_ref().join("known_hosts.json");
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            entries: Mutex::new(entries),
            pending: Mutex::new(HashMap::new()),
            app_handle,
            counter: AtomicU64::new(1),
        }
    }

    fn persist(&self) {
        if let Ok(entries) = self.entries.lock()
            && let Ok(json) = serde_json::to_string_pretty(&*entries)
        {
            let _ = fs::write(&self.path, json);
        }
    }

    /// Verify a presented host-key fingerprint, prompting the user on first use.
    /// Returns `true` if the connection should proceed.
    pub async fn verify(&self, host: &str, port: u16, fingerprint: &str) -> bool {
        let key = format!("{host}:{port}");

        let stored = self
            .entries
            .lock()
            .ok()
            .and_then(|entries| entries.get(&key).cloned());
        match stored {
            Some(existing) if existing == fingerprint => return true,
            Some(existing) => {
                let _ = self.app_handle.emit(
                    HOSTKEY_CHANGED_EVENT,
                    HostKeyChangedEvent {
                        host: host.to_string(),
                        port,
                        stored_fingerprint: existing,
                        presented_fingerprint: fingerprint.to_string(),
                    },
                );
                return false;
            }
            None => {}
        }

        // Unknown host — enqueue a waiter, raising a prompt only for the first.
        let (tx, rx) = oneshot::channel();
        let should_emit = {
            let mut pending = match self.pending.lock() {
                Ok(pending) => pending,
                Err(_) => return false,
            };
            match pending.get_mut(&key) {
                Some(entry) => {
                    entry.waiters.push(tx);
                    false
                }
                None => {
                    pending.insert(
                        key.clone(),
                        PendingPrompt {
                            fingerprint: fingerprint.to_string(),
                            waiters: vec![tx],
                        },
                    );
                    true
                }
            }
        };

        if should_emit {
            let _ = self.app_handle.emit(
                HOSTKEY_PROMPT_EVENT,
                HostKeyPromptEvent {
                    prompt_id: key.clone(),
                    host: host.to_string(),
                    port,
                    fingerprint: fingerprint.to_string(),
                },
            );
        }

        match tokio::time::timeout(PROMPT_TIMEOUT, rx).await {
            Ok(Ok(true)) => true,
            _ => {
                // On timeout/cancel, clear our waiter so a later attempt re-prompts.
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&key);
                }
                false
            }
        }
    }

    /// Resolve a pending prompt (called from the `respond_host_key_prompt`
    /// command). On acceptance the fingerprint is trusted for future connects.
    pub fn respond(&self, prompt_id: &str, accept: bool) {
        let pending = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(prompt_id));
        let Some(pending) = pending else {
            return;
        };
        if accept {
            if let Ok(mut entries) = self.entries.lock() {
                entries.insert(prompt_id.to_string(), pending.fingerprint);
            }
            self.persist();
        }
        for waiter in pending.waiters {
            let _ = waiter.send(accept);
        }
    }

    /// A monotonically increasing id, available if opaque prompt ids are needed.
    #[allow(dead_code)]
    pub fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::Relaxed)
    }
}
