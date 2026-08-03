use crate::config::DATABASE_FILE_NAME;

pub mod profile_repository;

pub use profile_repository::{KubernetesAuditRecord, ProfileRepository};

#[derive(Debug, Clone)]
pub struct StorageConfig {
    pub database_file_name: &'static str,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            database_file_name: DATABASE_FILE_NAME,
        }
    }
}
