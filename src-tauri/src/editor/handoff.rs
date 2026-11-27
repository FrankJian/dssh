use super::workspaces::WorkspaceLease;
use crate::error::{AppError, AppResult};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Notify;
#[derive(Default)]
struct Status {
    ready: Option<bool>,
    committed: Option<bool>,
}
struct Handoff {
    source: WorkspaceLease,
    target: String,
    status: Mutex<Status>,
    notify: Notify,
    created: Instant,
}
#[derive(Clone, Default)]
pub struct EditorHandoffs {
    entries: Arc<Mutex<HashMap<String, Arc<Handoff>>>>,
}
fn invalid() -> AppError {
    AppError::new("editor_handoff", "编辑器窗口交接已失效或不属于当前窗口。")
}
impl EditorHandoffs {
    pub fn start(&self, source: WorkspaceLease, target: &str) -> AppResult<String> {
        source.ensure_active()?;
        let mut entries = self.entries.lock().map_err(|_| invalid())?;
        entries.retain(|_, h| h.created.elapsed() < Duration::from_secs(120));
        if entries.len() >= 16
            || entries.values().any(|h| {
                h.source.workspace.id == source.workspace.id
                    && h.status.lock().is_ok_and(|s| s.committed.is_none())
            })
        {
            return Err(invalid());
        }
        let id = format!("editor-handoff-{:032x}", rand::random::<u128>());
        entries.insert(
            id.clone(),
            Arc::new(Handoff {
                source,
                target: target.into(),
                status: Mutex::default(),
                notify: Notify::new(),
                created: Instant::now(),
            }),
        );
        Ok(id)
    }
    fn get(&self, id: &str) -> AppResult<Arc<Handoff>> {
        self.entries
            .lock()
            .map_err(|_| invalid())?
            .get(id)
            .cloned()
            .ok_or_else(invalid)
    }
    pub fn ready(&self, target: &str, id: &str, ready: bool) -> AppResult<()> {
        let handoff = self.get(id)?;
        if handoff.target != target {
            return Err(invalid());
        }
        let mut status = handoff.status.lock().map_err(|_| invalid())?;
        if status.ready.is_some() || status.committed.is_some() {
            return Err(invalid());
        }
        handoff.source.ensure_active()?;
        status.ready = Some(ready);
        drop(status);
        handoff.notify.notify_waiters();
        Ok(())
    }
    pub fn finish(
        &self,
        source: &str,
        id: &str,
        commit: bool,
        close_source: impl FnOnce(&str) -> AppResult<()>,
    ) -> AppResult<()> {
        let handoff = self.get(id)?;
        if handoff.source.owner != source {
            return Err(invalid());
        }
        let mut status = handoff.status.lock().map_err(|_| invalid())?;
        if status.committed.is_some() {
            return Err(invalid());
        }
        if commit {
            handoff.source.ensure_active()?;
            if status.ready != Some(true) {
                return Err(invalid());
            }
            close_source(&handoff.source.workspace.id)?;
        }
        status.committed = Some(commit);
        drop(status);
        handoff.notify.notify_waiters();
        Ok(())
    }
    pub async fn wait(&self, owner: &str, id: &str, release: bool) -> AppResult<bool> {
        let handoff = self.get(id)?;
        if if release {
            handoff.target != owner
        } else {
            handoff.source.owner != owner
        } {
            return Err(invalid());
        }
        let result = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let changed = handoff.notify.notified();
                let result = {
                    let status = handoff.status.lock().map_err(|_| invalid())?;
                    if release {
                        status.committed
                    } else {
                        status.ready.or(status.committed.map(|_| false))
                    }
                };
                if let Some(value) = result {
                    return Ok(value);
                }
                changed.await;
            }
        })
        .await
        .unwrap_or(Ok(false));
        if release {
            self.entries.lock().map_err(|_| invalid())?.remove(id);
        }
        result
    }
    pub fn close_owner(&self, owner: &str) {
        if let Ok(entries) = self.entries.lock() {
            for handoff in entries
                .values()
                .filter(|h| h.source.owner == owner || h.target == owner)
            {
                if let Ok(mut status) = handoff.status.lock()
                    && status.committed.is_none()
                {
                    status.ready = Some(false);
                    status.committed = Some(false);
                    handoff.notify.notify_waiters();
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::workspaces::{EditorManager, FileSource};
    #[tokio::test]
    async fn acknowledged_handoff_is_owner_scoped_and_releases_source_only_on_commit() {
        let manager = EditorManager::default();
        let workspace = manager
            .open("source", FileSource::Local, None, None, None)
            .unwrap();
        let handoffs = EditorHandoffs::default();
        let id = handoffs
            .start(manager.require("source", &workspace.id).unwrap(), "target")
            .unwrap();
        assert!(handoffs.ready("foreign", &id, true).is_err());
        assert!(handoffs.wait("foreign", &id, false).await.is_err());
        assert!(
            handoffs
                .finish("source", &id, true, |_| panic!("premature release"))
                .is_err()
        );
        handoffs.ready("target", &id, true).unwrap();
        assert!(handoffs.wait("source", &id, false).await.unwrap());
        assert!(manager.require("source", &workspace.id).is_ok());
        assert!(
            handoffs
                .finish("foreign", &id, true, |_| panic!("foreign release"))
                .is_err()
        );
        handoffs
            .finish("source", &id, true, |id| manager.close("source", id))
            .unwrap();
        assert!(manager.require("source", &workspace.id).is_err());
        assert!(handoffs.wait("target", &id, true).await.unwrap());
        assert!(handoffs.ready("target", &id, true).is_err());
    }
    #[tokio::test]
    async fn failed_initialization_and_window_destruction_keep_source_documents() {
        let manager = EditorManager::default();
        let workspace = manager
            .open("source", FileSource::Local, None, None, None)
            .unwrap();
        let lease = manager.require("source", &workspace.id).unwrap();
        let handoffs = EditorHandoffs::default();
        let id = handoffs.start(lease.clone(), "target").unwrap();
        handoffs.ready("target", &id, false).unwrap();
        assert!(!handoffs.wait("source", &id, false).await.unwrap());
        handoffs
            .finish("source", &id, false, |_| panic!("aborted release"))
            .unwrap();
        assert!(!handoffs.wait("target", &id, true).await.unwrap());
        assert!(lease.ensure_active().is_ok());
        let id = handoffs.start(lease.clone(), "target").unwrap();
        handoffs.close_owner("target");
        assert!(!handoffs.wait("source", &id, false).await.unwrap());
        assert!(lease.ensure_active().is_ok());
    }
}
