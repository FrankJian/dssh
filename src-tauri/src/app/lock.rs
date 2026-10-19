use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use rand::RngExt;
use tauri::{AppHandle, Emitter};

use crate::{
    error::{AppError, AppResult},
    models::app_lock::{AppLockStatus, StoredAppLockSettings, UpdateAppLockSettingsRequest},
    storage::ProfileRepository,
};

pub const APP_LOCK_STATE_EVENT: &str = "app://lock-state";
const MIN_PASSWORD_CHARS: usize = 6;
const MIN_TIMEOUT_MINUTES: u16 = 1;
const MAX_TIMEOUT_MINUTES: u16 = 240;

struct RuntimeState {
    settings: StoredAppLockSettings,
    locked: bool,
    last_activity: Instant,
}

#[derive(Clone)]
pub struct AppLockManager {
    inner: Arc<AppLockInner>,
}

struct AppLockInner {
    app_handle: AppHandle,
    repository: ProfileRepository,
    state: Mutex<RuntimeState>,
}

impl AppLockManager {
    pub fn initialize(repository: ProfileRepository, app_handle: AppHandle) -> AppResult<Self> {
        let settings = repository.get_app_lock_settings()?;
        Ok(Self {
            inner: Arc::new(AppLockInner {
                app_handle,
                repository,
                state: Mutex::new(RuntimeState {
                    locked: settings.enabled,
                    settings,
                    last_activity: Instant::now(),
                }),
            }),
        })
    }

    pub fn status(&self) -> AppResult<AppLockStatus> {
        let state = self.lock_state()?;
        Ok(AppLockStatus {
            settings: state.settings.public_settings(),
            locked: state.locked,
        })
    }

    pub fn update_settings(
        &self,
        request: UpdateAppLockSettingsRequest,
    ) -> AppResult<AppLockStatus> {
        validate_timeout(request.timeout_minutes)?;
        let mut state = self.lock_state()?;
        let mut next = state.settings.clone();

        if request.enabled {
            match (
                next.password_hash.as_deref(),
                request.new_password.as_deref(),
            ) {
                (None, Some(password)) => next.password_hash = Some(hash_password(password)?),
                (None, None) => {
                    return Err(AppError::new(
                        "app_lock_password_required",
                        "请先设置锁屏密码。",
                    ));
                }
                (Some(hash), Some(password)) => {
                    verify_password(hash, request.current_password.as_deref())?;
                    next.password_hash = Some(hash_password(password)?);
                }
                (Some(_), None) => {}
            }
        } else if next.enabled {
            verify_password(
                next.password_hash.as_deref().ok_or_else(|| {
                    AppError::new("app_lock_password_required", "锁屏密码不可用，请重新设置。")
                })?,
                request.current_password.as_deref(),
            )?;
            next.password_hash = None;
        }

        next.enabled = request.enabled;
        next.auto_lock_enabled = request.enabled && request.auto_lock_enabled;
        next.timeout_minutes = request.timeout_minutes;
        self.inner.repository.save_app_lock_settings(&next)?;

        state.settings = next;
        if !state.settings.enabled {
            state.locked = false;
        }
        state.last_activity = Instant::now();
        let status = status_from_state(&state);
        drop(state);
        self.emit(&status);
        Ok(status)
    }

    pub fn lock(&self) -> AppResult<AppLockStatus> {
        let mut state = self.lock_state()?;
        if !state.settings.enabled {
            return Err(AppError::new("app_lock_disabled", "请先在设置中开启锁屏。"));
        }
        state.locked = true;
        let status = status_from_state(&state);
        drop(state);
        self.emit(&status);
        Ok(status)
    }

    pub fn unlock(&self, password: &str) -> AppResult<AppLockStatus> {
        let mut state = self.lock_state()?;
        let hash = state.settings.password_hash.as_deref().ok_or_else(|| {
            AppError::new("app_lock_password_required", "锁屏密码不可用，请重新设置。")
        })?;
        verify_password(hash, Some(password))?;
        state.locked = false;
        state.last_activity = Instant::now();
        let status = status_from_state(&state);
        drop(state);
        self.emit(&status);
        Ok(status)
    }

    pub fn record_activity(&self) -> AppResult<()> {
        let mut state = self.lock_state()?;
        if !state.locked && state.settings.enabled {
            state.last_activity = Instant::now();
        }
        Ok(())
    }

    pub fn lock_if_idle(&self) -> AppResult<AppLockStatus> {
        let mut state = self.lock_state()?;
        if !state.locked
            && state.settings.enabled
            && state.settings.auto_lock_enabled
            && state.last_activity.elapsed().as_secs()
                >= u64::from(state.settings.timeout_minutes) * 60
        {
            state.locked = true;
            let status = status_from_state(&state);
            drop(state);
            self.emit(&status);
            return Ok(status);
        }
        Ok(status_from_state(&state))
    }

    fn lock_state(&self) -> AppResult<std::sync::MutexGuard<'_, RuntimeState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| AppError::new("app_lock_error", "无法读取锁屏状态。"))
    }

    fn emit(&self, status: &AppLockStatus) {
        let _ = self.inner.app_handle.emit(APP_LOCK_STATE_EVENT, status);
    }
}

fn status_from_state(state: &RuntimeState) -> AppLockStatus {
    AppLockStatus {
        settings: state.settings.public_settings(),
        locked: state.locked,
    }
}

fn validate_timeout(timeout_minutes: u16) -> AppResult<()> {
    if !(MIN_TIMEOUT_MINUTES..=MAX_TIMEOUT_MINUTES).contains(&timeout_minutes) {
        return Err(AppError::new(
            "app_lock_timeout_invalid",
            format!("自动锁屏时间需在 {MIN_TIMEOUT_MINUTES} 到 {MAX_TIMEOUT_MINUTES} 分钟之间。"),
        ));
    }
    Ok(())
}

fn hash_password(password: &str) -> AppResult<String> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(AppError::new(
            "app_lock_password_invalid",
            format!("锁屏密码至少需要 {MIN_PASSWORD_CHARS} 个字符。"),
        ));
    }
    let mut salt_bytes = [0u8; 16];
    rand::rng().fill(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|error| AppError::new("app_lock_error", error.to_string()))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| AppError::new("app_lock_error", format!("无法设置锁屏密码：{error}")))
}

fn verify_password(hash: &str, password: Option<&str>) -> AppResult<()> {
    let password = password.unwrap_or_default();
    let parsed = PasswordHash::new(hash)
        .map_err(|_| AppError::new("app_lock_error", "保存的锁屏密码无效。"))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| AppError::new("app_lock_password_incorrect", "锁屏密码不正确。"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hashes_verify_without_storing_the_plaintext() {
        let hash = hash_password("secret-123").expect("hash should be created");
        assert!(!hash.contains("secret-123"));
        assert!(verify_password(&hash, Some("secret-123")).is_ok());
        assert!(verify_password(&hash, Some("wrong-password")).is_err());
    }

    #[test]
    fn timeout_has_safe_bounds() {
        assert!(validate_timeout(15).is_ok());
        assert!(validate_timeout(0).is_err());
        assert!(validate_timeout(241).is_err());
    }
}
