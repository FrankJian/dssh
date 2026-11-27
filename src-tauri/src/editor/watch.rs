use crate::error::{AppError, AppResult};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

/// Watches parent directories so atomic replacement does not detach the watch.
/// Events are invalidation hints only; consumers must read a fresh content version.
pub struct LocalWatch {
    _watcher: RecommendedWatcher,
    cancel: CancellationToken,
}
impl LocalWatch {
    pub fn start(paths: Vec<PathBuf>, changed: impl Fn() + Send + 'static) -> AppResult<Self> {
        if paths.len() > 128 {
            return Err(AppError::new(
                "editor_watch_budget",
                "同时监视的文件不能超过 128 个。",
            ));
        }
        let mut parents = HashSet::new();
        let mut targets = HashSet::new();
        for path in paths {
            let path = super::local::canonical_target(&path)?;
            let parent = path
                .parent()
                .ok_or_else(|| AppError::new("editor_watch_path", "无法监视此文件路径。"))?;
            parents.insert(parent.to_path_buf());
            targets.insert(path);
        }
        let revision = Arc::new(AtomicU64::new(0));
        let updates = revision.clone();
        let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            if event
                .as_ref()
                .is_ok_and(|event| matches!(event.kind, notify::EventKind::Access(_)))
            {
                return;
            }
            if event.is_err()
                || event.as_ref().is_ok_and(|event| {
                    event.need_rescan()
                        || event.paths.is_empty()
                        || event.paths.iter().any(|path| targets.contains(path))
                })
            {
                updates.fetch_add(1, Ordering::Relaxed);
            }
        })
        .map_err(watch_error)?;
        for parent in parents {
            watcher
                .watch(&parent, RecursiveMode::NonRecursive)
                .map_err(watch_error)?;
        }
        let cancel = CancellationToken::new();
        let cancelled = cancel.clone();
        tokio::spawn(async move {
            let mut seen = 0;
            let mut interval = tokio::time::interval(Duration::from_millis(250));
            loop {
                tokio::select! {
                    _ = cancelled.cancelled() => break,
                    _ = interval.tick() => {
                        let next = revision.load(Ordering::Relaxed);
                        if next != seen { seen = next; changed(); }
                    }
                }
            }
        });
        Ok(Self {
            _watcher: watcher,
            cancel,
        })
    }
}
impl Drop for LocalWatch {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
fn watch_error(_: notify::Error) -> AppError {
    AppError::new(
        "editor_watch",
        "文件变更通知不可用，将在聚焦和保存时重新检查版本。",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn parent_watch_detects_atomic_replacement_and_drop_stops_notifications() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a.txt");
        std::fs::write(&path, "before").unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let watch = LocalWatch::start(vec![path.clone()], move || {
            let _ = tx.send(());
        })
        .unwrap();
        let temporary = directory.path().join("replacement");
        std::fs::write(&temporary, "after").unwrap();
        std::fs::rename(temporary, &path).unwrap();
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .unwrap();
        drop(watch);
        // Cancellation closes the task's channel; no new notifications remain subscribed.
        tokio::time::timeout(Duration::from_secs(2), async {
            while rx.recv().await.is_some() {}
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn watcher_rejects_unbounded_or_relative_targets() {
        assert!(LocalWatch::start(vec![PathBuf::from("relative")], || {}).is_err());
        assert!(LocalWatch::start(vec![PathBuf::from("/a"); 129], || {}).is_err());
    }
}
