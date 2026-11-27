pub mod ai;
pub mod app;
pub mod app_lock;
pub mod artifactory;
pub mod config;
pub mod editor;
pub mod editor_files;
pub mod forwarding;
pub mod hosttools;
pub mod network_scan;
pub mod profiles;
pub mod s3;
pub mod sessions;
pub mod sftp;
pub mod tools;
pub mod workspace;

pub mod browser;
pub mod rdp;
pub mod smb;

pub mod jumpserver;

/// Run filesystem, database and CPU work away from both the window thread and
/// the async workers servicing SSH. Preserve normal user-facing AppErrors.
async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> crate::error::AppResult<T> + Send + 'static,
) -> crate::error::AppResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| {
            crate::error::AppError::new("background_task_failed", "后台任务异常，请重试。")
        })?
}
