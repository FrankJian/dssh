use std::sync::Arc;

use tauri::Manager;

use crate::{
    ai::AiManager,
    error::{AppError, AppResult},
    forwarding::ForwardManager,
    kubernetes::KubernetesManager,
    s3::S3Manager,
    sftp::SftpManager,
    ssh::{HostKeyVerifier, SessionManager, SshConnectionDiagnostics, SshConnectionPool},
    storage::{ProfileRepository, StorageConfig},
    workspace::DetachedWorkspaceManager,
};

#[derive(Clone)]
pub struct AppState {
    pub profiles: ProfileRepository,
    pub sessions: SessionManager,
    pub sftp: SftpManager,
    pub s3: S3Manager,
    pub kubernetes: KubernetesManager,
    pub forwards: ForwardManager,
    pub ai: AiManager,
    pub host_keys: Arc<HostKeyVerifier>,
    pub ssh_diagnostics: Arc<SshConnectionDiagnostics>,
    pub ssh_pool: SshConnectionPool,
    pub detached_workspaces: DetachedWorkspaceManager,
}

impl AppState {
    pub fn initialize(app_handle: &tauri::AppHandle) -> AppResult<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| AppError::new("app_data_dir_error", error.to_string()))?;
        let storage_config = StorageConfig::default();

        // The host-key verifier persists trusted fingerprints next to the DB and
        // is shared by every SSH connection path (terminal / SFTP / forward / AI).
        let host_keys = Arc::new(HostKeyVerifier::initialize(
            &app_data_dir,
            app_handle.clone(),
        ));
        let ssh_diagnostics = Arc::new(SshConnectionDiagnostics::default());
        let ssh_pool = SshConnectionPool::new(
            host_keys.clone(),
            ssh_diagnostics.clone(),
            app_handle.clone(),
        );
        ssh_pool.start_idle_reaper();

        Ok(Self {
            profiles: ProfileRepository::initialize(
                app_data_dir,
                storage_config.database_file_name,
            )?,
            sessions: SessionManager::new(ssh_pool.clone()),
            sftp: SftpManager::new(ssh_pool.clone()),
            s3: S3Manager::default(),
            kubernetes: KubernetesManager::default(),
            forwards: ForwardManager::new(ssh_pool.clone()),
            ai: AiManager::default(),
            host_keys,
            ssh_diagnostics,
            ssh_pool,
            detached_workspaces: DetachedWorkspaceManager::default(),
        })
    }
}
