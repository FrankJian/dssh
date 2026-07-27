//! GitHub Copilot authentication and token management.
//!
//! Copilot is not a static-API-key provider. Access is obtained via the GitHub
//! OAuth **device flow** (using VS Code / Copilot CLI's GitHub App client id),
//! which yields a long-lived `ghu_` GitHub token. That token is then exchanged
//! at `/copilot_internal/v2/token` for a short-lived session token (~30 min)
//! plus the real API base URL. Chat/model requests use the session token with a
//! set of editor-identity headers, without which the API returns 403.
//!
//! The long-lived `ghu_` token is persisted in SQLite; the short-lived session
//! token is cached in memory and refreshed shortly before it expires.

use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::{
    ai::client::build_reqwest_client,
    app::AppState,
    error::{AppError, AppResult},
    models::ai::{CopilotAuthEvent, CopilotDeviceInfo},
};

/// VS Code / Copilot CLI GitHub App client id. Only tokens minted by this app
/// (`ghu_...`) can be exchanged at the Copilot token endpoint.
const CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL: &str = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_AUTH_EVENT: &str = "copilot-auth";

/// Storage key for the long-lived GitHub token in the secrets table.
pub const GITHUB_TOKEN_KEY: &str = "copilot.github_token";

const USER_AGENT: &str = "GitHubCopilotChat/0.26.7";
const EDITOR_VERSION: &str = "vscode/1.99.3";
const EDITOR_PLUGIN_VERSION: &str = "copilot-chat/0.26.7";
const COPILOT_INTEGRATION_ID: &str = "vscode-chat";

/// Editor-identity headers required by the Copilot token exchange and API.
pub fn api_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("User-Agent", HeaderValue::from_static(USER_AGENT));
    headers.insert("Editor-Version", HeaderValue::from_static(EDITOR_VERSION));
    headers.insert(
        "Editor-Plugin-Version",
        HeaderValue::from_static(EDITOR_PLUGIN_VERSION),
    );
    headers.insert(
        "Copilot-Integration-Id",
        HeaderValue::from_static(COPILOT_INTEGRATION_ID),
    );
    headers
}

/// A cached short-lived Copilot session token and its resolved API base.
#[derive(Debug, Clone)]
pub struct CopilotSession {
    pub token: String,
    pub api_base: String,
    /// Absolute expiry in milliseconds since the Unix epoch.
    pub expires_at_ms: u128,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    expires_in: u64,
    #[serde(default)]
    interval: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct CopilotTokenResponse {
    token: String,
    expires_at: u64,
    endpoints: CopilotEndpoints,
}

#[derive(Deserialize)]
struct CopilotEndpoints {
    api: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn request_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("copilot_request_error", error.to_string())
}

/// Begin the device-authorization flow: request a device code, then spawn a
/// background task that polls for completion and emits `copilot-auth` events.
/// Returns the code/URL the UI should show the user.
pub async fn start_login(
    app: AppHandle,
    state: AppState,
    proxy_url: String,
) -> AppResult<CopilotDeviceInfo> {
    let client = build_reqwest_client(&proxy_url)?;

    let response = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&serde_json::json!({ "client_id": CLIENT_ID, "scope": "read:user" }))
        .send()
        .await
        .map_err(request_error)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            "copilot_request_error",
            format!("申请设备码失败（HTTP {status}）：{body}"),
        ));
    }

    let device: DeviceCodeResponse = response.json().await.map_err(request_error)?;
    let interval = device.interval.max(1);
    let expires_in = if device.expires_in == 0 {
        900
    } else {
        device.expires_in
    };
    let info = CopilotDeviceInfo {
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        expires_in,
        interval,
    };

    state.ai.copilot_login_active.store(true, Ordering::SeqCst);
    let device_code = device.device_code;
    tauri::async_runtime::spawn(async move {
        poll_loop(app, state, client, device_code, interval, expires_in).await;
    });

    Ok(info)
}

enum PollOutcome {
    Token(String),
    Pending,
    SlowDown,
}

async fn poll_loop(
    app: AppHandle,
    state: AppState,
    client: reqwest::Client,
    device_code: String,
    interval: u64,
    expires_in: u64,
) {
    let deadline = now_secs() + expires_in;
    let mut wait = interval;

    loop {
        if !state.ai.copilot_login_active.load(Ordering::SeqCst) {
            return;
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
        if !state.ai.copilot_login_active.load(Ordering::SeqCst) {
            return;
        }
        if now_secs() > deadline {
            emit(
                &app,
                CopilotAuthEvent::Error {
                    message: "登录超时，请重试。".to_string(),
                },
            );
            break;
        }

        match poll_once(&client, &device_code).await {
            Ok(PollOutcome::Token(token)) => {
                if let Err(error) = state.profiles.set_secret(GITHUB_TOKEN_KEY, &token) {
                    emit(
                        &app,
                        CopilotAuthEvent::Error {
                            message: format!("保存登录凭据失败：{}", error.message),
                        },
                    );
                    break;
                }
                *state.ai.copilot_session.lock().await = None;
                emit(&app, CopilotAuthEvent::Success);
                break;
            }
            Ok(PollOutcome::Pending) => {}
            Ok(PollOutcome::SlowDown) => wait = wait.saturating_add(5),
            Err(message) => {
                emit(&app, CopilotAuthEvent::Error { message });
                break;
            }
        }
    }

    state.ai.copilot_login_active.store(false, Ordering::SeqCst);
}

async fn poll_once(client: &reqwest::Client, device_code: &str) -> Result<PollOutcome, String> {
    let response = client
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&serde_json::json!({
            "client_id": CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Ok(PollOutcome::Pending);
    }

    let data: AccessTokenResponse = response.json().await.map_err(|error| error.to_string())?;
    if let Some(token) = data.access_token {
        return Ok(PollOutcome::Token(token));
    }

    match data.error.as_deref() {
        Some("authorization_pending") | None => Ok(PollOutcome::Pending),
        Some("slow_down") => Ok(PollOutcome::SlowDown),
        Some("expired_token") => Err("登录码已过期，请重试。".to_string()),
        Some("access_denied") => Err("已取消授权。".to_string()),
        Some(other) => Err(format!("登录失败：{other}")),
    }
}

/// Return a valid `(api_base, session_token)`, refreshing the cached session
/// token from the stored GitHub token if it is missing or near expiry.
pub async fn ensure_session_token(
    state: &AppState,
    proxy_url: &str,
) -> AppResult<(String, String)> {
    let github_token = state
        .profiles
        .get_secret(GITHUB_TOKEN_KEY)?
        .ok_or_else(|| {
            AppError::new(
                "copilot_not_logged_in",
                "尚未登录 GitHub Copilot，请在设置中登录。",
            )
        })?;

    let mut guard = state.ai.copilot_session.lock().await;
    if let Some(session) = guard.as_ref() {
        // Refresh a minute early to avoid using a token that expires mid-request.
        if session.expires_at_ms > now_ms() + 60_000 {
            return Ok((session.api_base.clone(), session.token.clone()));
        }
    }

    let client = build_reqwest_client(proxy_url)?;
    let response = client
        .get(COPILOT_TOKEN_URL)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {github_token}"))
        .headers(api_headers())
        .send()
        .await
        .map_err(request_error)?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let code = if status.as_u16() == 401 || status.as_u16() == 404 {
            "copilot_not_logged_in"
        } else {
            "copilot_token_error"
        };
        return Err(AppError::new(
            code,
            format!("获取 Copilot 令牌失败（HTTP {status}）：{body}"),
        ));
    }

    let data: CopilotTokenResponse = response.json().await.map_err(request_error)?;
    let session = CopilotSession {
        token: data.token,
        api_base: data.endpoints.api,
        expires_at_ms: (data.expires_at as u128) * 1000,
    };
    *guard = Some(session.clone());
    Ok((session.api_base, session.token))
}

/// Whether a GitHub token is currently stored (i.e. the user is logged in).
pub fn status(state: &AppState) -> AppResult<bool> {
    Ok(state.profiles.get_secret(GITHUB_TOKEN_KEY)?.is_some())
}

/// Clear the stored GitHub token and any cached session token.
pub async fn logout(state: &AppState) -> AppResult<()> {
    state.ai.copilot_login_active.store(false, Ordering::SeqCst);
    state.profiles.delete_secret(GITHUB_TOKEN_KEY)?;
    *state.ai.copilot_session.lock().await = None;
    Ok(())
}

/// Stop any in-flight device-flow polling (e.g. the user closed the dialog).
pub fn cancel_login(state: &AppState) {
    state.ai.copilot_login_active.store(false, Ordering::SeqCst);
}

fn emit(app: &AppHandle, event: CopilotAuthEvent) {
    let _ = app.emit(COPILOT_AUTH_EVENT, event);
}
