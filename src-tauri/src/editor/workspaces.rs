use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::Mutex as AsyncMutex;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FileSource {
    Local,
    Sftp {
        #[serde(rename = "profileId")]
        profile_id: String,
    },
}

impl FileSource {
    pub fn key(&self) -> String {
        match self {
            Self::Local => "local".to_owned(),
            Self::Sftp { profile_id } => format!("sftp:{profile_id}"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorWorkspace {
    pub id: String,
    pub source: FileSource,
    pub root_path: Option<String>,
    pub initial_file: Option<String>,
}

#[derive(Clone)]
pub struct WorkspaceLease {
    pub workspace: EditorWorkspace,
    pub profile_version: Option<String>,
    pub owner: String,
    active: Arc<AtomicBool>,
}

impl WorkspaceLease {
    pub fn ensure_profile_version(&self, current: &str) -> AppResult<()> {
        self.ensure_active()?;
        if self.profile_version.as_deref() != Some(current) {
            return Err(AppError::new(
                "editor_stale_source",
                "连接配置已变化，请重新打开编辑工作区。",
            ));
        }
        Ok(())
    }
    pub fn ensure_active(&self) -> AppResult<()> {
        if self.active.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(unavailable())
        }
    }
}

type SaveLocks = HashMap<(String, String), Weak<AsyncMutex<()>>>;

#[derive(Clone, Default)]
pub struct EditorManager {
    pub handoffs: super::handoff::EditorHandoffs,
    pub scans: super::search::ScanManager,
    pub file_operations: super::file_operations::FileOperations,
    scopes: Arc<Mutex<HashMap<String, WorkspaceLease>>>,
    save_locks: Arc<Mutex<SaveLocks>>,
    watches: Arc<Mutex<HashMap<String, super::watch::LocalWatch>>>,
}

fn unavailable() -> AppError {
    AppError::new(
        "editor_workspace_unavailable",
        "编辑工作区已关闭、已移窗或不属于当前窗口。",
    )
}
fn state_error() -> AppError {
    AppError::new("editor_state", "无法读取编辑工作区状态，请重试。")
}

impl EditorManager {
    pub fn set_watch(
        &self,
        owner: &str,
        workspace_id: &str,
        watch: Option<super::watch::LocalWatch>,
    ) -> AppResult<()> {
        // Keep the same scopes -> watches lock order as owner cleanup.
        let scopes = self.scopes.lock().map_err(|_| state_error())?;
        scopes
            .get(workspace_id)
            .filter(|scope| scope.owner == owner)
            .ok_or_else(unavailable)?
            .ensure_active()?;
        let mut watches = self.watches.lock().map_err(|_| state_error())?;
        watches.remove(workspace_id);
        if let Some(watch) = watch {
            watches.insert(workspace_id.to_owned(), watch);
        }
        Ok(())
    }
    pub fn open(
        &self,
        owner: &str,
        source: FileSource,
        root_path: Option<String>,
        initial_file: Option<String>,
        profile_version: Option<String>,
    ) -> AppResult<EditorWorkspace> {
        let workspace = EditorWorkspace {
            id: format!("editor-{:032x}", rand::random::<u128>()),
            source,
            root_path,
            initial_file,
        };
        self.scopes.lock().map_err(|_| state_error())?.insert(
            workspace.id.clone(),
            WorkspaceLease {
                workspace: workspace.clone(),
                owner: owner.to_owned(),
                profile_version,
                active: Arc::new(AtomicBool::new(true)),
            },
        );
        Ok(workspace)
    }

    pub fn require(&self, owner: &str, workspace_id: &str) -> AppResult<WorkspaceLease> {
        let scopes = self.scopes.lock().map_err(|_| state_error())?;
        let scope = scopes
            .get(workspace_id)
            .filter(|scope| scope.owner == owner)
            .ok_or_else(unavailable)?;
        scope.ensure_active()?;
        Ok(scope.clone())
    }

    pub fn close(&self, owner: &str, workspace_id: &str) -> AppResult<()> {
        let mut scopes = self.scopes.lock().map_err(|_| state_error())?;
        let scope = scopes
            .get(workspace_id)
            .filter(|scope| scope.owner == owner)
            .ok_or_else(unavailable)?;
        scope.active.store(false, Ordering::Release);
        scopes.remove(workspace_id);
        self.scans.close_workspace(workspace_id);
        self.file_operations.close(Some(workspace_id), None);
        drop(scopes);
        self.watches
            .lock()
            .map_err(|_| state_error())?
            .remove(workspace_id);
        Ok(())
    }

    pub fn close_owner(&self, owner: &str) -> AppResult<()> {
        self.handoffs.close_owner(owner);
        self.scans.close_owner(owner);
        self.file_operations.close(None, Some(owner));
        self.scopes
            .lock()
            .map_err(|_| state_error())?
            .retain(|_, scope| {
                if scope.owner != owner {
                    true
                } else {
                    scope.active.store(false, Ordering::Release);
                    false
                }
            });
        let scopes = self.scopes.lock().map_err(|_| state_error())?;
        self.watches
            .lock()
            .map_err(|_| state_error())?
            .retain(|id, _| scopes.contains_key(id));
        Ok(())
    }

    pub fn save_lock(
        &self,
        source: &FileSource,
        canonical_path: &str,
    ) -> AppResult<Arc<AsyncMutex<()>>> {
        let mut locks = self.save_locks.lock().map_err(|_| state_error())?;
        let key = (source.key(), canonical_path.to_owned());
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        if locks.len() > 1024 {
            locks.retain(|_, value| value.strong_count() > 0);
        }
        let lock = Arc::new(AsyncMutex::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        Ok(lock)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_bind_window_and_source_and_revoke_existing_leases() {
        let manager = EditorManager::default();
        let scope = manager
            .open(
                "main",
                FileSource::Sftp {
                    profile_id: "saved-1".into(),
                },
                Some("/etc".into()),
                None,
                Some("version1".into()),
            )
            .unwrap();
        assert!(manager.require("detached-1", &scope.id).is_err());
        assert!(manager.close("detached-1", &scope.id).is_err());
        let lease = manager.require("main", &scope.id).unwrap();
        assert_eq!(lease.profile_version.as_deref(), Some("version1"));
        assert!(lease.ensure_profile_version("version1").is_ok());
        assert_eq!(
            lease.ensure_profile_version("version2").unwrap_err().code,
            "editor_stale_source"
        );
        manager.close("main", &scope.id).unwrap();
        assert!(manager.require("main", &scope.id).is_err());
        assert!(lease.ensure_active().is_err());
    }

    #[test]
    fn owner_cleanup_isolated_from_other_windows() {
        let manager = EditorManager::default();
        let first = manager
            .open("main", FileSource::Local, None, None, None)
            .unwrap();
        let second = manager
            .open("detached-1", FileSource::Local, None, None, None)
            .unwrap();
        manager.close_owner("main").unwrap();
        assert!(manager.require("main", &first.id).is_err());
        assert!(manager.require("detached-1", &second.id).is_ok());
    }

    #[test]
    fn saves_across_workspaces_share_source_path_lock_only() {
        let manager = EditorManager::default();
        let a = manager.save_lock(&FileSource::Local, "/a").unwrap();
        let b = manager.save_lock(&FileSource::Local, "/a").unwrap();
        let c = manager
            .save_lock(
                &FileSource::Sftp {
                    profile_id: "a".into(),
                },
                "/a",
            )
            .unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert!(!Arc::ptr_eq(&a, &c));
    }

    #[tokio::test]
    async fn concurrent_window_saves_cannot_both_commit_the_same_version() {
        use crate::editor::{
            local,
            text::{LineEnding, TextEncoding, TextMetadata},
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a");
        std::fs::write(&path, "old").unwrap();
        let token = local::current_version(&path).unwrap();
        let manager = EditorManager::default();
        let key = local::save_lock_key(&path).unwrap();
        let save = |text: &'static str| {
            let lock = manager.save_lock(&FileSource::Local, &key).unwrap();
            let token = token.clone();
            let path = path.clone();
            async move {
                let _guard = lock.lock().await;
                local::save(
                    &path,
                    text,
                    &TextMetadata {
                        encoding: TextEncoding::Utf8,
                        bom: false,
                        line_ending: LineEnding::Lf,
                    },
                    Some(&token),
                )
            }
        };
        let (a, b) = tokio::join!(save("first"), save("second"));
        assert!(a.is_ok());
        assert_eq!(b.unwrap_err().code, "editor_conflict");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
    }
}
