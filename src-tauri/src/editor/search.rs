use super::{
    contracts::EditorTextFile,
    local, text,
    workspaces::{FileSource, WorkspaceLease},
};
use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    sftp::{SftpListing, SftpManager},
};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, mpsc};
use tokio_util::sync::CancellationToken;

pub const MAX_DIRECTORIES: usize = 2_000;
pub const MAX_ENTRIES: usize = 100_000;
pub const MAX_SCAN_BYTES: u64 = 256 * 1024 * 1024;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub workspace_id: String,
    #[serde(default)]
    pub content: bool,
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default = "default_exclude")]
    pub exclude: Vec<String>,
    #[serde(default)]
    pub skip_paths: Vec<String>,
}
fn default_exclude() -> Vec<String> {
    ["**/.git", "**/node_modules", "**/target", "**/dist"]
        .map(str::to_owned)
        .into()
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub directories: usize,
    pub entries: usize,
    pub bytes: u64,
    pub unreadable: usize,
    pub binary: usize,
    pub encoding: usize,
    pub oversized: usize,
    pub links: usize,
    pub done: bool,
    pub reason: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanItem {
    pub path: String,
    pub relative_path: String,
    pub file: Option<EditorTextFile>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanBatch {
    pub operation_id: String,
    pub items: Vec<ScanItem>,
    pub progress: ScanProgress,
}
struct Operation {
    workspace: String,
    owner: String,
    cancel: CancellationToken,
    receiver: AsyncMutex<mpsc::Receiver<ScanItem>>,
    progress: Arc<Mutex<ScanProgress>>,
}
#[derive(Clone, Default)]
pub struct ScanManager {
    operations: Arc<Mutex<HashMap<String, Arc<Operation>>>>,
}
fn unavailable() -> AppError {
    AppError::new("editor_scan_unavailable", "搜索已取消或不属于当前工作区。")
}
impl ScanManager {
    pub fn start(
        &self,
        lease: WorkspaceLease,
        request: ScanRequest,
        remote: Option<(SftpManager, SshProfile)>,
    ) -> AppResult<String> {
        lease.ensure_active()?;
        let root = lease
            .workspace
            .root_path
            .clone()
            .ok_or_else(|| AppError::new("editor_scan_root", "请先打开一个文件夹。"))?;
        if request.skip_paths.len() > 10_000
            || request.skip_paths.iter().map(String::len).sum::<usize>() > 2 * 1024 * 1024
        {
            return Err(AppError::new(
                "editor_scan_budget",
                "打开文档数量超过搜索预算。",
            ));
        }
        let filters = Filters::new(&request)?;
        let id = format!("scan-{:032x}", rand::random::<u128>());
        let (sender, receiver) = mpsc::channel(if request.content { 1 } else { 128 });
        let progress = Arc::new(Mutex::new(ScanProgress::default()));
        let cancel = CancellationToken::new();
        let operation = Arc::new(Operation {
            workspace: lease.workspace.id.clone(),
            owner: lease.owner.clone(),
            cancel: cancel.clone(),
            receiver: AsyncMutex::new(receiver),
            progress: progress.clone(),
        });
        let mut operations = self.operations.lock().map_err(|_| unavailable())?;
        // At most one live scan per workspace, including completed but unconsumed scans.
        operations.retain(|_, old| {
            if old.workspace == operation.workspace {
                old.cancel.cancel();
                false
            } else {
                true
            }
        });
        operations.insert(id.clone(), operation);
        drop(operations);
        tokio::spawn(async move {
            let provider = ScanProvider {
                lease,
                root,
                remote,
            };
            let mut walker = Walker::new(&provider.root);
            let skip: HashSet<_> = request.skip_paths.into_iter().collect();
            loop {
                if cancel.is_cancelled() || provider.lease.ensure_active().is_err() {
                    walker.progress.reason = Some("cancelled".into());
                    break;
                }
                let next = tokio::select! { _ = cancel.cancelled() => { walker.progress.reason = Some("cancelled".into()); break; }, next = walker.next(&provider, &filters) => next };
                let Some((path, relative_path, size)) = next else {
                    break;
                };
                if skip.contains(&path) {
                    continue;
                }
                let file = if request.content {
                    if size > text::NORMAL_TEXT_BYTES as u64 {
                        walker.progress.oversized += 1;
                        continue;
                    }
                    // Reserve the complete bounded read, including growth and failed decoding.
                    // Failed reads conservatively consume this reservation rather than bypassing the budget.
                    let reservation = text::NORMAL_TEXT_BYTES as u64 + 1;
                    if walker.progress.bytes.saturating_add(reservation) > MAX_SCAN_BYTES {
                        walker.progress.reason = Some("bytes".into());
                        break;
                    }
                    let result = tokio::select! { _ = cancel.cancelled() => { walker.progress.reason = Some("cancelled".into()); break; }, result = provider.read(&path) => result };
                    walker.progress.bytes += reservation;
                    match result {
                        Ok(file) => {
                            walker.progress.bytes -= reservation - file.byte_length;
                            Some(file)
                        }
                        Err(error) => {
                            match error.code.as_str() {
                                "editor_binary" => walker.progress.binary += 1,
                                "editor_encoding" => walker.progress.encoding += 1,
                                "editor_large_file" | "editor_text_too_large" => {
                                    walker.progress.oversized += 1
                                }
                                _ => walker.progress.unreadable += 1,
                            };
                            continue;
                        }
                    }
                } else {
                    None
                };
                if let Ok(mut current) = progress.lock() {
                    *current = walker.progress.clone();
                }
                let item = ScanItem {
                    path,
                    relative_path,
                    file,
                };
                tokio::select! { _ = cancel.cancelled() => { walker.progress.reason = Some("cancelled".into()); break; }, sent = sender.send(item) => { if sent.is_err() { break; } } }
            }
            walker.progress.done = true;
            if let Ok(mut current) = progress.lock() {
                *current = walker.progress;
            }
        });
        Ok(id)
    }
    fn require(&self, owner: &str, workspace: &str, id: &str) -> AppResult<Arc<Operation>> {
        self.operations
            .lock()
            .map_err(|_| unavailable())?
            .get(id)
            .filter(|operation| operation.owner == owner && operation.workspace == workspace)
            .cloned()
            .ok_or_else(unavailable)
    }
    pub async fn next(&self, owner: &str, workspace: &str, id: &str) -> AppResult<ScanBatch> {
        let operation = self.require(owner, workspace, id)?;
        let mut receiver = operation.receiver.lock().await;
        let first = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
            .await
            .ok()
            .flatten();
        let mut items: Vec<_> = first.into_iter().collect();
        // Content batches contain at most one complete file; name batches can contain 128 paths.
        if items.first().is_some_and(|item| item.file.is_none()) {
            while items.len() < 128 {
                match receiver.try_recv() {
                    Ok(item) => items.push(item),
                    Err(_) => break,
                }
            }
        }
        let mut progress = operation
            .progress
            .lock()
            .map_err(|_| unavailable())?
            .clone();
        // done is observable only after the bounded channel has been drained.
        progress.done &= receiver.is_closed() && receiver.is_empty();
        if progress.done {
            self.operations
                .lock()
                .map_err(|_| unavailable())?
                .remove(id);
        }
        Ok(ScanBatch {
            operation_id: id.into(),
            items,
            progress,
        })
    }
    pub fn cancel(&self, owner: &str, workspace: &str, id: &str) -> AppResult<()> {
        self.require(owner, workspace, id)?.cancel.cancel();
        self.operations
            .lock()
            .map_err(|_| unavailable())?
            .remove(id);
        Ok(())
    }
    pub fn close_workspace(&self, workspace: &str) {
        if let Ok(mut operations) = self.operations.lock() {
            operations.retain(|_, operation| {
                if operation.workspace == workspace {
                    operation.cancel.cancel();
                    false
                } else {
                    true
                }
            });
        }
    }
    pub fn close_owner(&self, owner: &str) {
        if let Ok(mut operations) = self.operations.lock() {
            operations.retain(|_, operation| {
                if operation.owner == owner {
                    operation.cancel.cancel();
                    false
                } else {
                    true
                }
            });
        }
    }
}
struct Filters {
    include: GlobSet,
    exclude: GlobSet,
    all: bool,
    hidden: bool,
}
fn glob_set(patterns: &[String]) -> AppResult<GlobSet> {
    if patterns.len() > 64 || patterns.iter().any(|pattern| pattern.len() > 512) {
        return Err(AppError::new(
            "editor_glob_budget",
            "包含/排除规则过多或过长。",
        ));
    }
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(
            GlobBuilder::new(pattern)
                .literal_separator(true)
                .build()
                .map_err(|_| AppError::new("editor_glob", "包含/排除 glob 无效。"))?,
        );
    }
    builder
        .build()
        .map_err(|_| AppError::new("editor_glob", "包含/排除 glob 无效。"))
}
impl Filters {
    fn new(request: &ScanRequest) -> AppResult<Self> {
        Ok(Self {
            include: glob_set(&request.include)?,
            exclude: glob_set(&request.exclude)?,
            all: request.include.is_empty(),
            hidden: request.show_hidden,
        })
    }
    fn excluded(&self, relative: &str) -> bool {
        (!self.hidden && relative.split('/').any(|part| part.starts_with('.')))
            || relative
                .match_indices('/')
                .map(|(index, _)| &relative[..index])
                .chain(std::iter::once(relative))
                .any(|part| {
                    self.exclude.is_match(part) || self.exclude.is_match(format!("{part}/"))
                })
    }
    fn matches(&self, relative: &str) -> bool {
        !self.excluded(relative) && (self.all || self.include.is_match(relative))
    }
}
pub struct ScanProvider {
    pub lease: WorkspaceLease,
    pub root: String,
    pub remote: Option<(SftpManager, SshProfile)>,
}
impl ScanProvider {
    fn relative(&self, path: &str) -> Option<String> {
        if cfg!(windows) && self.lease.workspace.source == FileSource::Local {
            relative_path(&self.root.replace('\\', "/"), &path.replace('\\', "/"))
        } else {
            relative_path(&self.root, path)
        }
    }
    async fn list(&self, path: &str, limit: usize) -> AppResult<(SftpListing, bool)> {
        self.lease.ensure_active()?;
        let result = if let Some((manager, profile)) = &self.remote {
            let session = manager.editor_session(profile).await?;
            let canonical = session.canonical_path(path, false).await?;
            if self.relative(&canonical).is_none()
                || canonical.trim_end_matches('/') != path.trim_end_matches('/')
            {
                return Err(unavailable());
            }
            session.check_type(&canonical, true).await?;
            session.list_bounded(&canonical, limit, &self.lease).await?
        } else {
            let path = PathBuf::from(path);
            let root = PathBuf::from(&self.root);
            tokio::task::spawn_blocking(move || {
                if std::fs::symlink_metadata(&path)
                    .map_err(local::io_error)?
                    .file_type()
                    .is_symlink()
                {
                    return Err(unavailable());
                }
                let canonical = std::fs::canonicalize(&path).map_err(local::io_error)?;
                let root = std::fs::canonicalize(root).map_err(local::io_error)?;
                if !canonical.starts_with(&root) {
                    return Err(unavailable());
                }
                local::list_bounded(&canonical, limit)
            })
            .await
            .map_err(|_| unavailable())??
        };
        if self.relative(&result.0.path).is_none() {
            return Err(unavailable());
        }
        Ok(result)
    }
    async fn read(&self, path: &str) -> AppResult<EditorTextFile> {
        if let Some((manager, profile)) = &self.remote {
            let session = manager.editor_session(profile).await?;
            let canonical = session.canonical_path(path, true).await?;
            if self.relative(&canonical).is_none() {
                return Err(unavailable());
            }
            let read = session
                .read(&profile.id, &canonical, false, &self.lease)
                .await?;
            if self.relative(&read.path).is_none() {
                return Err(unavailable());
            }
            let byte_length = read.data.len() as u64;
            let read_only = read
                .attributes
                .permissions
                .is_none_or(|mode| mode & 0o222 == 0);
            let path = read.path.clone();
            let decoded =
                tokio::task::spawn_blocking(move || text::decode(&path, &read.data, None))
                    .await
                    .map_err(|_| unavailable())??;
            Ok(EditorTextFile {
                source: self.lease.workspace.source.clone(),
                path: read.path,
                content: decoded.content,
                metadata: decoded.metadata,
                version_token: read.version,
                read_only,
                byte_length,
                large_file: false,
            })
        } else {
            let path = PathBuf::from(path);
            let root = PathBuf::from(&self.root);
            let file = tokio::task::spawn_blocking(move || {
                let target = local::canonical_target(&path)?;
                let root = std::fs::canonicalize(root).map_err(local::io_error)?;
                if !target.starts_with(root) {
                    return Err(unavailable());
                }
                local::read(&target, None, false)
            })
            .await
            .map_err(|_| unavailable())??;
            Ok(EditorTextFile {
                source: FileSource::Local,
                path: file.path,
                content: file.content,
                metadata: file.metadata,
                version_token: file.version_token,
                read_only: file.read_only,
                byte_length: file.byte_length,
                large_file: false,
            })
        }
    }
}
/// Canonical paths only: component boundaries prevent /root-other from entering /root.
pub fn relative_path(root: &str, path: &str) -> Option<String> {
    let root = root.trim_end_matches('/');
    let relative = if path == root {
        ""
    } else {
        path.strip_prefix(&format!("{root}/"))?
    };
    if relative.split('/').any(|part| part == ".." || part == ".") {
        return None;
    }
    Some(relative.into())
}
struct Walker {
    directories: VecDeque<String>,
    entries: VecDeque<crate::sftp::SftpEntry>,
    visited: HashSet<String>,
    progress: ScanProgress,
}
impl Walker {
    fn new(root: &str) -> Self {
        Self {
            directories: VecDeque::from([root.into()]),
            entries: VecDeque::new(),
            visited: HashSet::new(),
            progress: ScanProgress::default(),
        }
    }
    async fn next(
        &mut self,
        provider: &ScanProvider,
        filters: &Filters,
    ) -> Option<(String, String, u64)> {
        loop {
            provider.lease.ensure_active().ok()?;
            if let Some(entry) = self.entries.pop_front() {
                if self.progress.entries >= MAX_ENTRIES {
                    self.progress.reason = Some("entries".into());
                    return None;
                }
                self.progress.entries += 1;
                let Some(relative) = provider.relative(&entry.path) else {
                    self.progress.unreadable += 1;
                    continue;
                };
                if filters.excluded(&relative) {
                    continue;
                }
                if entry.is_symlink {
                    self.progress.links += 1;
                    continue;
                }
                if entry.is_dir {
                    if self.directories.len() + self.progress.directories >= MAX_DIRECTORIES {
                        self.progress.reason = Some("directories".into());
                        continue;
                    }
                    self.directories.push_back(entry.path);
                } else if filters.matches(&relative) {
                    return Some((entry.path, relative, entry.size));
                }
                continue;
            }
            let path = self.directories.pop_front()?;
            if !self.visited.insert(path.clone()) {
                continue;
            }
            if self.progress.directories >= MAX_DIRECTORIES {
                self.progress.reason = Some("directories".into());
                return None;
            }
            self.progress.directories += 1;
            match provider
                .list(&path, MAX_ENTRIES - self.progress.entries)
                .await
            {
                Ok((listing, truncated)) => {
                    if truncated {
                        self.progress.reason = Some("entries".into());
                    }
                    // Bound retained entries even when one directory is enormous.
                    let remaining = MAX_ENTRIES - self.progress.entries;
                    if listing.entries.len() > remaining {
                        self.progress.reason = Some("entries".into());
                    }
                    self.entries
                        .extend(listing.entries.into_iter().take(remaining));
                }
                Err(_) => self.progress.unreadable += 1,
            }
        }
    }
}

pub fn filter_open_paths(lease: &WorkspaceLease, request: &ScanRequest) -> AppResult<Vec<String>> {
    if request.skip_paths.len() > 10_000
        || request.skip_paths.iter().map(String::len).sum::<usize>() > 2 * 1024 * 1024
    {
        return Err(AppError::new(
            "editor_scan_budget",
            "打开文档数量超过搜索预算。",
        ));
    }
    let root = lease
        .workspace
        .root_path
        .as_deref()
        .ok_or_else(|| AppError::new("editor_scan_root", "请先打开一个文件夹。"))?;
    let filters = Filters::new(request)?;
    Ok(request
        .skip_paths
        .iter()
        .filter(|path| {
            let relative = if cfg!(windows) && lease.workspace.source == FileSource::Local {
                relative_path(&root.replace('\\', "/"), &path.replace('\\', "/"))
            } else {
                relative_path(root, path)
            };
            relative.is_some_and(|relative| filters.matches(&relative))
        })
        .cloned()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::workspaces::EditorManager;
    fn request(id: &str, content: bool) -> ScanRequest {
        ScanRequest {
            workspace_id: id.into(),
            content,
            show_hidden: false,
            include: vec![],
            exclude: default_exclude(),
            skip_paths: vec![],
        }
    }
    async fn collect(
        manager: &EditorManager,
        workspace: &str,
        operation: &str,
    ) -> (Vec<ScanItem>, ScanProgress) {
        let mut items = Vec::new();
        for _ in 0..1000 {
            let batch = manager
                .scans
                .next("main", workspace, operation)
                .await
                .unwrap();
            items.extend(batch.items);
            if batch.progress.done {
                return (items, batch.progress);
            }
        }
        panic!("scan did not finish");
    }
    #[tokio::test]
    async fn local_scan_applies_globs_hidden_defaults_and_content_versions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();
        for path in [
            "a.ts",
            ".secret.ts",
            "nested/b.ts",
            "nested/c.txt",
            "node_modules/skipped.ts",
        ] {
            std::fs::write(dir.path().join(path), "中文 😀\nconst test = 1;").unwrap();
        }
        let manager = EditorManager::default();
        let workspace = manager
            .open(
                "main",
                FileSource::Local,
                Some(local::display_path(&std::fs::canonicalize(dir.path()).unwrap()).unwrap()),
                None,
                None,
            )
            .unwrap();
        let mut query = request(&workspace.id, true);
        query.include = vec!["**/*.ts".into()];
        let id = manager
            .scans
            .start(manager.require("main", &workspace.id).unwrap(), query, None)
            .unwrap();
        assert!(
            manager
                .scans
                .next("other", &workspace.id, &id)
                .await
                .is_err()
        );
        let (mut files, progress) = collect(&manager, &workspace.id, &id).await;
        files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        assert_eq!(
            files
                .iter()
                .map(|f| f.relative_path.as_str())
                .collect::<Vec<_>>(),
            ["a.ts", "nested/b.ts"]
        );
        for item in files {
            let file = item.file.unwrap();
            assert_eq!(
                file.version_token,
                local::current_version(&PathBuf::from(file.path)).unwrap()
            );
        }
        assert_eq!(progress.directories, 2);
        assert!(progress.reason.is_none());
    }
    #[tokio::test]
    async fn scan_counts_encoding_binary_and_oversize_and_skips_open_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("invalid.txt"), [0xff]).unwrap();
        std::fs::write(dir.path().join("binary.zip"), b"PK\x03\x04").unwrap();
        std::fs::write(dir.path().join("open.txt"), "old disk").unwrap();
        let large = std::fs::File::create(dir.path().join("large.txt")).unwrap();
        large.set_len(text::NORMAL_TEXT_BYTES as u64 + 1).unwrap();
        let manager = EditorManager::default();
        let workspace = manager
            .open(
                "main",
                FileSource::Local,
                Some(local::display_path(&std::fs::canonicalize(dir.path()).unwrap()).unwrap()),
                None,
                None,
            )
            .unwrap();
        let mut query = request(&workspace.id, true);
        query.skip_paths = vec![
            local::display_path(&std::fs::canonicalize(dir.path().join("open.txt")).unwrap())
                .unwrap(),
        ];
        let id = manager
            .scans
            .start(manager.require("main", &workspace.id).unwrap(), query, None)
            .unwrap();
        let (files, progress) = collect(&manager, &workspace.id, &id).await;
        assert!(files.is_empty());
        assert_eq!(progress.encoding, 1);
        assert_eq!(progress.binary, 1);
        assert_eq!(progress.oversized, 1);
        assert!(progress.bytes <= MAX_SCAN_BYTES);
    }
    #[tokio::test]
    async fn replacing_or_closing_scan_revokes_old_operation_and_relative_roots_are_bounded() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a"), "value").unwrap();
        let manager = EditorManager::default();
        let workspace = manager
            .open(
                "main",
                FileSource::Local,
                Some(local::display_path(&std::fs::canonicalize(dir.path()).unwrap()).unwrap()),
                None,
                None,
            )
            .unwrap();
        let id = manager
            .scans
            .start(
                manager.require("main", &workspace.id).unwrap(),
                request(&workspace.id, false),
                None,
            )
            .unwrap();
        let next = manager
            .scans
            .start(
                manager.require("main", &workspace.id).unwrap(),
                request(&workspace.id, false),
                None,
            )
            .unwrap();
        assert!(
            manager
                .scans
                .next("main", &workspace.id, &id)
                .await
                .is_err()
        );
        manager.close("main", &workspace.id).unwrap();
        assert!(
            manager
                .scans
                .next("main", &workspace.id, &next)
                .await
                .is_err()
        );
        assert_eq!(relative_path("/root", "/root2/a"), None);
        assert_eq!(relative_path("/root", "/root/../a"), None);
        assert_eq!(relative_path("/", "/a"), Some("a".into()));
        assert_eq!(relative_path("/root", "/root/a\\b"), Some("a\\b".into()));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn search_never_recurses_through_directory_links() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("private"), "not scanned").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        let manager = EditorManager::default();
        let workspace = manager
            .open(
                "main",
                FileSource::Local,
                Some(local::display_path(&std::fs::canonicalize(dir.path()).unwrap()).unwrap()),
                None,
                None,
            )
            .unwrap();
        let id = manager
            .scans
            .start(
                manager.require("main", &workspace.id).unwrap(),
                request(&workspace.id, true),
                None,
            )
            .unwrap();
        let (files, progress) = collect(&manager, &workspace.id, &id).await;
        assert!(files.is_empty());
        assert_eq!(progress.links, 1);
        assert_eq!(progress.directories, 1);
    }
    #[tokio::test]
    async fn failed_decodes_still_consume_the_total_scan_budget() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..14 {
            let file =
                std::fs::File::create(dir.path().join(format!("binary-{index}.bin"))).unwrap();
            file.set_len(text::NORMAL_TEXT_BYTES as u64).unwrap();
        }
        let manager = EditorManager::default();
        let root = local::display_path(&std::fs::canonicalize(dir.path()).unwrap()).unwrap();
        let workspace = manager
            .open("main", FileSource::Local, Some(root), None, None)
            .unwrap();
        let id = manager
            .scans
            .start(
                manager.require("main", &workspace.id).unwrap(),
                request(&workspace.id, true),
                None,
            )
            .unwrap();
        let (files, progress) = collect(&manager, &workspace.id, &id).await;
        assert!(files.is_empty());
        assert_eq!(progress.reason.as_deref(), Some("bytes"));
        assert!(progress.bytes <= MAX_SCAN_BYTES);
        assert!(progress.binary < 14);
    }
    #[test]
    fn opened_paths_share_hidden_glob_and_root_rules() {
        let manager = EditorManager::default();
        let workspace = manager
            .open("main", FileSource::Local, Some("/root".into()), None, None)
            .unwrap();
        let mut query = request(&workspace.id, false);
        query.skip_paths = vec![
            "/root/a.ts".into(),
            "/root/nested/node_modules/a.ts".into(),
            "/root/.hidden".into(),
            "/root-other/a.ts".into(),
        ];
        assert_eq!(
            filter_open_paths(&manager.require("main", &workspace.id).unwrap(), &query).unwrap(),
            ["/root/a.ts"]
        );
        query.show_hidden = true;
        query.exclude.clear();
        assert_eq!(
            filter_open_paths(&manager.require("main", &workspace.id).unwrap(), &query)
                .unwrap()
                .len(),
            3
        );
    }
    #[test]
    fn glob_validation_and_component_boundaries_are_explicit() {
        let mut query = request("id", false);
        query.include = vec!["[".into()];
        assert!(Filters::new(&query).is_err());
        query.include = vec!["*".repeat(600)];
        assert!(Filters::new(&query).is_err());
        let filters = Filters::new(&request("id", false)).unwrap();
        assert!(filters.excluded("nested/target"));
        assert!(!filters.excluded("target-other"));
    }
}
