use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockSettings {
    pub enabled: bool,
    pub auto_lock_enabled: bool,
    pub timeout_minutes: u16,
    pub has_password: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockStatus {
    pub settings: AppLockSettings,
    pub locked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAppLockSettingsRequest {
    pub enabled: bool,
    pub auto_lock_enabled: bool,
    pub timeout_minutes: u16,
    pub current_password: Option<String>,
    pub new_password: Option<String>,
}

/// Rust-only representation. The password hash never crosses the Tauri IPC
/// boundary and is deliberately not serializable.
#[derive(Debug, Clone)]
pub struct StoredAppLockSettings {
    pub enabled: bool,
    pub auto_lock_enabled: bool,
    pub timeout_minutes: u16,
    pub password_hash: Option<String>,
}

impl StoredAppLockSettings {
    pub fn public_settings(&self) -> AppLockSettings {
        AppLockSettings {
            enabled: self.enabled,
            auto_lock_enabled: self.auto_lock_enabled,
            timeout_minutes: self.timeout_minutes,
            has_password: self.password_hash.is_some(),
        }
    }
}
