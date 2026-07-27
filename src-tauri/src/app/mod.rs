use std::sync::Arc;

use tauri::Manager;

use crate::{
    ai::AiManager,
    error::{AppError, AppResult},
    forwarding::ForwardManager,
    s3::S3Manager,
    sftp::SftpManager,
    ssh::{HostKeyVerifier, SessionManager},
    storage::{ProfileRepository, StorageConfig},
};

#[derive(Clone)]
pub struct AppState {
    pub profiles: ProfileRepository,
    pub sessions: SessionManager,
    pub sftp: SftpManager,
    pub s3: S3Manager,
    pub forwards: ForwardManager,
    pub ai: AiManager,
    pub host_keys: Arc<HostKeyVerifier>,
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

        Ok(Self {
            profiles: ProfileRepository::initialize(
                app_data_dir,
                storage_config.database_file_name,
            )?,
            sessions: SessionManager::new(host_keys.clone()),
            sftp: SftpManager::new(host_keys.clone()),
            s3: S3Manager::default(),
            forwards: ForwardManager::new(host_keys.clone()),
            ai: AiManager::default(),
            host_keys,
        })
    }
}
