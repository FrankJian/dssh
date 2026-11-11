use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use futures::StreamExt;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tokio::{io::AsyncWriteExt, sync::Semaphore};
use tokio_util::{io::ReaderStream, sync::CancellationToken};

use super::{checked, item_segments, network_error, request, trusted};
use crate::error::{AppError, AppResult};

const EVENT: &str = "artifactory://transfer";
const MAX_TASKS: usize = 200;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferKind {
    Upload,
    Download,
    Archive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    pub id: String,
    pub profile_id: String,
    pub repo: String,
    pub path: String,
    pub name: String,
    pub kind: TransferKind,
    pub status: TransferStatus,
    pub transferred: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueTransferRequest {
    profile_id: String,
    repo: String,
    path: String,
    local_path: String,
    kind: TransferKind,
    #[serde(default)]
    overwrite: bool,
}

struct StoredTask {
    task: TransferTask,
    request: EnqueueTransferRequest,
    cancellation: CancellationToken,
    last_emit: Instant,
}

struct TransferManager {
    tasks: Mutex<Vec<StoredTask>>,
    slots: Semaphore,
}

fn manager() -> Arc<TransferManager> {
    static MANAGER: OnceLock<Arc<TransferManager>> = OnceLock::new();
    MANAGER
        .get_or_init(|| {
            Arc::new(TransferManager {
                tasks: Mutex::new(Vec::new()),
                slots: Semaphore::new(2),
            })
        })
        .clone()
}

impl TransferManager {
    fn list(&self) -> Vec<TransferTask> {
        self.tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .map(|entry| entry.task.clone())
            .collect()
    }

    fn insert(
        self: &Arc<Self>,
        app: AppHandle,
        request: EnqueueTransferRequest,
    ) -> AppResult<TransferTask> {
        let name = if matches!(request.kind, TransferKind::Archive) {
            format!(
                "{}.zip",
                request
                    .path
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&request.repo)
            )
        } else {
            request
                .path
                .rsplit('/')
                .next()
                .unwrap_or(&request.path)
                .to_string()
        };
        let task = TransferTask {
            id: format!("art-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)),
            profile_id: request.profile_id.clone(),
            repo: request.repo.clone(),
            path: request.path.clone(),
            name,
            kind: request.kind,
            status: TransferStatus::Queued,
            transferred: 0,
            total: None,
            error: None,
        };
        let cancellation = CancellationToken::new();
        {
            let mut tasks = self
                .tasks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if tasks.len() >= MAX_TASKS {
                if let Some(index) = tasks.iter().position(|entry| {
                    matches!(
                        entry.task.status,
                        TransferStatus::Completed
                            | TransferStatus::Failed
                            | TransferStatus::Cancelled
                    )
                }) {
                    tasks.remove(index);
                } else {
                    return Err(AppError::new(
                        "artifactory_queue_full",
                        "传输队列已满，请等待或取消部分任务。",
                    ));
                }
            }
            tasks.push(StoredTask {
                task: task.clone(),
                request: request.clone(),
                cancellation: cancellation.clone(),
                last_emit: Instant::now() - Duration::from_secs(1),
            });
        }
        let _ = app.emit(EVENT, &task);
        let this = self.clone();
        let id = task.id.clone();
        tokio::spawn(async move {
            this.run(app, id, request, cancellation).await;
        });
        Ok(task)
    }

    fn update(
        &self,
        app: &AppHandle,
        id: &str,
        status: Option<TransferStatus>,
        bytes: u64,
        total: Option<u64>,
        error: Option<String>,
    ) {
        let snapshot = {
            let mut tasks = self
                .tasks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(entry) = tasks.iter_mut().find(|entry| entry.task.id == id) else {
                return;
            };
            if let Some(status) = status {
                entry.task.status = status;
            }
            entry.task.transferred = entry.task.transferred.saturating_add(bytes);
            if let Some(total) = total {
                entry.task.total = Some(total);
            }
            entry.task.error = error;
            if status.is_some() || entry.last_emit.elapsed() >= Duration::from_millis(150) {
                entry.last_emit = Instant::now();
                Some(entry.task.clone())
            } else {
                None
            }
        };
        if let Some(task) = snapshot {
            let _ = app.emit(EVENT, task);
        }
    }

    async fn run(
        self: Arc<Self>,
        app: AppHandle,
        id: String,
        request: EnqueueTransferRequest,
        cancellation: CancellationToken,
    ) {
        let permit = tokio::select! {
            _ = cancellation.cancelled() => { self.update(&app, &id, Some(TransferStatus::Cancelled), 0, None, None); return; }
            result = self.slots.acquire() => result,
        };
        let Ok(_permit) = permit else {
            return;
        };
        if cancellation.is_cancelled() {
            self.update(&app, &id, Some(TransferStatus::Cancelled), 0, None, None);
            return;
        }
        self.update(&app, &id, Some(TransferStatus::Running), 0, None, None);
        let result = match request.kind {
            TransferKind::Upload => self.upload(&app, &id, &request, &cancellation).await,
            TransferKind::Download | TransferKind::Archive => {
                self.download(&app, &id, &request, &cancellation).await
            }
        };
        if cancellation.is_cancelled() {
            self.update(&app, &id, Some(TransferStatus::Cancelled), 0, None, None);
        } else if let Err(error) = result {
            self.update(
                &app,
                &id,
                Some(TransferStatus::Failed),
                0,
                None,
                Some(error.message),
            );
        } else {
            self.update(&app, &id, Some(TransferStatus::Completed), 0, None, None);
        }
    }

    async fn upload(
        &self,
        app: &AppHandle,
        id: &str,
        spec: &EnqueueTransferRequest,
        cancellation: &CancellationToken,
    ) -> AppResult<()> {
        let parts = item_segments(&spec.repo, &spec.path)?;
        let refs: Vec<_> = parts.iter().map(String::as_str).collect();
        let file = tokio::fs::File::open(&spec.local_path).await?;
        let length = file.metadata().await?.len();
        self.update(app, id, None, 0, Some(length), None);
        let task_id = id.to_string();
        let handle = app.clone();
        let queue = manager();
        let stream = ReaderStream::new(file).map(move |chunk| {
            if let Ok(bytes) = &chunk {
                queue.update(&handle, &task_id, None, bytes.len() as u64, None, None);
            }
            chunk
        });
        let builder = request(app, &spec.profile_id, Method::PUT, &refs)
            .await?
            .header(reqwest::header::CONTENT_LENGTH, length)
            .body(reqwest::Body::wrap_stream(stream));
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Ok(()),
            result = builder.send() => result.map_err(network_error)?,
        };
        checked(response).await?;
        Ok(())
    }

    async fn download(
        &self,
        app: &AppHandle,
        id: &str,
        spec: &EnqueueTransferRequest,
        cancellation: &CancellationToken,
    ) -> AppResult<()> {
        let parts = item_segments(&spec.repo, &spec.path)?;
        let mut segments: Vec<&str> = if matches!(spec.kind, TransferKind::Archive) {
            vec!["api", "archive", "download"]
        } else {
            Vec::new()
        };
        segments.extend(parts.iter().map(String::as_str));
        let mut builder = request(app, &spec.profile_id, Method::GET, &segments).await?;
        if matches!(spec.kind, TransferKind::Archive) {
            builder = builder.query(&[("archiveType", "zip")]);
        }
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Ok(()),
            result = builder.send() => result.map_err(network_error)?,
        };
        if matches!(spec.kind, TransferKind::Archive)
            && response.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err(AppError::new(
                "artifactory_archive_denied",
                "目录下载被服务器拒绝，请检查读取权限、Xray 策略及 Folder Download 设置。",
            ));
        }
        let mut response = checked(response).await?;
        self.update(app, id, None, 0, response.content_length(), None);
        let destination = Path::new(&spec.local_path);
        if destination.exists() && !spec.overwrite {
            return Err(AppError::new(
                "artifactory_exists",
                "本地文件已存在，请确认覆盖后重试。",
            ));
        }
        let parent = destination
            .parent()
            .ok_or_else(|| AppError::new("artifactory_path", "本地保存路径无效。"))?;
        let temp = parent.join(format!(".dssh-{}-{}.part", std::process::id(), id));
        let result = async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .await?;
            loop {
                let chunk = tokio::select! {
                    _ = cancellation.cancelled() => return Ok(()),
                    result = response.chunk() => result.map_err(network_error)?,
                };
                let Some(chunk) = chunk else {
                    break;
                };
                file.write_all(&chunk).await?;
                self.update(app, id, None, chunk.len() as u64, None, None);
            }
            file.flush().await?;
            drop(file);
            if cancellation.is_cancelled() {
                return Ok(());
            }
            if destination.exists() && !spec.overwrite {
                return Err(AppError::new(
                    "artifactory_exists",
                    "本地文件已存在，请确认覆盖后重试。",
                ));
            }
            replace_file(&temp, destination, spec.overwrite).await
        }
        .await;
        if result.is_err() || cancellation.is_cancelled() {
            let _ = tokio::fs::remove_file(&temp).await;
        }
        result
    }
}

async fn replace_file(temp: &Path, destination: &Path, overwrite: bool) -> AppResult<()> {
    if !destination.exists() {
        tokio::fs::rename(temp, destination).await?;
        return Ok(());
    }
    if !overwrite {
        return Err(AppError::new(
            "artifactory_exists",
            "本地文件已存在，请确认覆盖后重试。",
        ));
    }
    let backup: PathBuf = temp.with_extension("backup");
    tokio::fs::rename(destination, &backup).await?;
    if let Err(error) = tokio::fs::rename(temp, destination).await {
        let _ = tokio::fs::rename(&backup, destination).await;
        return Err(error.into());
    }
    let _ = tokio::fs::remove_file(backup).await;
    Ok(())
}

#[tauri::command]
pub fn artifactory_list_transfers(
    app: AppHandle,
    webview: Webview,
) -> AppResult<Vec<TransferTask>> {
    trusted(&app, &webview)?;
    Ok(manager().list())
}

#[tauri::command]
pub fn artifactory_enqueue_transfer(
    app: AppHandle,
    webview: Webview,
    request: EnqueueTransferRequest,
) -> AppResult<TransferTask> {
    trusted(&app, &webview)?;
    item_segments(&request.repo, &request.path)?;
    if !matches!(request.kind, TransferKind::Archive) && request.path.is_empty() {
        return Err(AppError::new("artifactory_path", "请选择文件或上传目标。"));
    }
    if request.local_path.is_empty() {
        return Err(AppError::new("artifactory_path", "本地路径不能为空。"));
    }
    app.state::<crate::app::AppState>()
        .profiles
        .get_artifactory_profile(&request.profile_id)?;
    manager().insert(app, request)
}

#[tauri::command]
pub fn artifactory_cancel_transfer(app: AppHandle, webview: Webview, id: String) -> AppResult<()> {
    trusted(&app, &webview)?;
    let manager = manager();
    let task = {
        let mut tasks = manager
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = tasks
            .iter_mut()
            .find(|entry| entry.task.id == id)
            .ok_or_else(|| AppError::new("artifactory_transfer", "传输任务不存在。"))?;
        if !matches!(
            entry.task.status,
            TransferStatus::Queued | TransferStatus::Running
        ) {
            return Ok(());
        }
        entry.cancellation.cancel();
        entry.task.status = TransferStatus::Cancelled;
        entry.task.clone()
    };
    let _ = app.emit(EVENT, task);
    Ok(())
}

#[tauri::command]
pub fn artifactory_retry_transfer(
    app: AppHandle,
    webview: Webview,
    id: String,
    overwrite: bool,
) -> AppResult<TransferTask> {
    trusted(&app, &webview)?;
    let manager = manager();
    let request = {
        let tasks = manager
            .tasks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = tasks
            .iter()
            .find(|entry| entry.task.id == id)
            .ok_or_else(|| AppError::new("artifactory_transfer", "传输任务不存在。"))?;
        if !matches!(
            entry.task.status,
            TransferStatus::Failed | TransferStatus::Cancelled
        ) {
            return Err(AppError::new(
                "artifactory_transfer",
                "只能重试失败或已取消的任务。",
            ));
        }
        let mut request = entry.request.clone();
        request.overwrite = overwrite || request.overwrite;
        request
    };
    manager.insert(app, request)
}

#[tauri::command]
pub fn artifactory_clear_transfers(app: AppHandle, webview: Webview) -> AppResult<()> {
    trusted(&app, &webview)?;
    manager()
        .tasks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .retain(|entry| {
            matches!(
                entry.task.status,
                TransferStatus::Queued | TransferStatus::Running
            )
        });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn replacement_preserves_existing_file_without_overwrite() {
        let directory = std::env::temp_dir().join(format!(
            "dssh-artifactory-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        tokio::fs::create_dir(&directory).await.unwrap();
        let destination = directory.join("artifact.txt");
        let first = directory.join("first.part");
        tokio::fs::write(&destination, b"original").await.unwrap();
        tokio::fs::write(&first, b"new").await.unwrap();
        assert!(replace_file(&first, &destination, false).await.is_err());
        assert_eq!(tokio::fs::read(&destination).await.unwrap(), b"original");
        replace_file(&first, &destination, true).await.unwrap();
        assert_eq!(tokio::fs::read(&destination).await.unwrap(), b"new");
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}
