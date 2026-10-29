//! Verified presets are shared with the UI, while endpoint resolution stays in Rust.
use crate::{
    error::{AppError, AppResult},
    models::ai::{AiProtocol, AiProviderConfig},
};
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    pub id: String,
    pub base_url: String,
    pub kind: AiProtocol,
    #[serde(default)]
    pub legacy_base_urls: Vec<String>,
}

pub fn presets() -> &'static [ProviderPreset] {
    static PRESETS: OnceLock<Vec<ProviderPreset>> = OnceLock::new();
    PRESETS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/ai/providerPresets.json"))
            .expect("verified provider catalog")
    })
}

/// Missing ids identify legacy descriptors. Explicit `custom` stays custom,
/// even if its address is the same as an official endpoint.
pub fn resolve_preset(provider: &mut AiProviderConfig) -> AppResult<()> {
    if provider.preset_id.is_none() {
        provider.preset_id = Some(
            presets()
                .iter()
                .find(|preset| {
                    preset.kind == provider.kind
                        && std::iter::once(&preset.base_url)
                            .chain(preset.legacy_base_urls.iter())
                            .any(|url| {
                                url.trim_end_matches('/')
                                    == provider.base_url.trim().trim_end_matches('/')
                            })
                })
                .map(|preset| preset.id.clone())
                .unwrap_or_else(|| "custom".into()),
        );
    }
    let id = provider.preset_id.as_deref().unwrap_or("custom");
    if id == "custom" {
        return Ok(());
    }
    let preset = presets()
        .iter()
        .find(|preset| preset.id == id)
        .ok_or_else(|| {
            AppError::new(
                "ai_config_error",
                "未知厂商预设，请重新选择厂商或使用自定义 API。",
            )
        })?;
    provider.base_url.clone_from(&preset.base_url);
    provider.kind = preset.kind;
    Ok(())
}

pub fn endpoint(provider: &AiProviderConfig) -> AppResult<String> {
    let mut resolved = provider.clone();
    resolve_preset(&mut resolved)?;
    if resolved.preset_id.as_deref() == Some("custom") {
        super::client::normalize_base_url(&resolved.base_url)
    } else {
        Ok(resolved.base_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_override_stale_or_tampered_endpoint_and_protocol() {
        for preset in presets() {
            let mut provider: AiProviderConfig = serde_json::from_value(serde_json::json!({
                "id":"test", "label":"test", "baseUrl":"https://unrelated.test/", "model":"test",
                "presetId":preset.id, "kind":"openai-responses"
            }))
            .unwrap();
            resolve_preset(&mut provider).unwrap();
            assert_eq!(provider.base_url, preset.base_url);
            assert_eq!(provider.kind, preset.kind);
            assert_eq!(endpoint(&provider).unwrap(), preset.base_url);
        }
    }
    #[test]
    fn legacy_endpoints_are_recognized_but_explicit_custom_is_preserved() {
        let mut provider: AiProviderConfig = serde_json::from_value(serde_json::json!({
            "id":"test", "label":"test", "baseUrl":"https://api.deepseek.com/v1/", "model":"test"
        }))
        .unwrap();
        resolve_preset(&mut provider).unwrap();
        assert_eq!(provider.preset_id.as_deref(), Some("deepseek"));
        assert_eq!(endpoint(&provider).unwrap(), "https://api.deepseek.com/");
        provider.preset_id = Some("custom".into());
        provider.base_url = "https://gateway.test/private/v2/".into();
        assert_eq!(
            endpoint(&provider).unwrap(),
            "https://gateway.test/private/v2/"
        );
    }
}
