use std::time::Duration;

use font_kit::source::SystemSource;
use serde::Serialize;

use crate::models::app::AppHealth;
use crate::{
    config::APP_NAME,
    error::{AppError, AppResult},
};

/// Update manifests are published to the GitHub release that the updater plugin
/// reads (`plugins.updater.endpoints` in tauri.conf.json). Keep both lists in
/// sync so the diagnostics below probe exactly what the updater uses.
const UPDATE_ENDPOINTS: [&str; 1] =
    ["https://github.com/FrankJian/dssh/releases/latest/download/latest.json"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEndpointDiagnostic {
    pub url: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn app_health() -> AppHealth {
    AppHealth {
        app_name: APP_NAME.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        status: "ok".to_string(),
    }
}

fn collect_system_font_families() -> AppResult<Vec<String>> {
    let mut families = SystemSource::new()
        .all_families()
        .map_err(|error| AppError::new("font_enumeration_failed", error.to_string()))?;
    families.retain(|family| !family.trim().is_empty());
    families.sort_unstable_by_key(|family| family.to_lowercase());
    families.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    Ok(families)
}

/// Enumerate installed system font families without exposing font files or
/// machine-specific paths to the frontend.
#[tauri::command]
pub async fn list_system_font_families() -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(collect_system_font_families)
        .await
        .map_err(|error| AppError::new("font_enumeration_failed", error.to_string()))?
}

/// Probe every configured updater manifest endpoint so the UI can show the
/// failure for each URL rather than only the updater plugin's final error.
///
/// `proxy` mirrors the proxy the user configured for update checks, so a failing
/// direct connection and a working proxied one are distinguishable here.
#[tauri::command]
pub async fn app_update_endpoint_diagnostics(
    proxy: Option<String>,
) -> Vec<UpdateEndpointDiagnostic> {
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(12));

    if let Some(url) = proxy.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        match reqwest::Proxy::all(url) {
            Ok(proxy) => builder = builder.proxy(proxy),
            Err(error) => {
                return UPDATE_ENDPOINTS
                    .iter()
                    .map(|url| UpdateEndpointDiagnostic {
                        url: (*url).to_string(),
                        error: Some(format!("代理地址无效：{error}")),
                    })
                    .collect();
            }
        }
    }

    let client = match builder.build() {
        Ok(client) => client,
        Err(error) => {
            return UPDATE_ENDPOINTS
                .iter()
                .map(|url| UpdateEndpointDiagnostic {
                    url: (*url).to_string(),
                    error: Some(error.to_string()),
                })
                .collect();
        }
    };

    let mut diagnostics = Vec::with_capacity(UPDATE_ENDPOINTS.len());
    for url in UPDATE_ENDPOINTS {
        let error = match client.get(url).send().await {
            Ok(response) if response.status().is_success() => None,
            Ok(response) => Some(format!("HTTP {}", response.status())),
            Err(error) => Some(error.to_string()),
        };
        diagnostics.push(UpdateEndpointDiagnostic {
            url: url.to_string(),
            error,
        });
    }
    diagnostics
}
