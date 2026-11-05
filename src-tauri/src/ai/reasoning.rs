//! UI levels are labels; send their configured API values without enum coercion.
use crate::{
    error::{AppError, AppResult},
    models::ai::{AiModelConfig, AiProtocol, AiReasoningLevel},
};
use genai::chat::ChatOptions;
use serde_json::{Value, json};

fn selected_level<'a>(
    model: &'a AiModelConfig,
    requested: Option<&str>,
) -> AppResult<Option<&'a AiReasoningLevel>> {
    let selected = requested.or(model.reasoning_effort.as_deref());
    match selected {
        None => Ok(None),
        Some(level) => model
            .reasoning_levels
            .iter()
            .find(|row| row.level == level)
            .map(Some)
            .ok_or_else(|| {
                AppError::new(
                    "ai_config_error",
                    "所选推理档位不在该模型的配置中，请重新选择。",
                )
            }),
    }
}

pub fn payload(protocol: AiProtocol, preset_id: Option<&str>, row: &AiReasoningLevel) -> Value {
    let off = row.level == "off";
    // Off's legacy/custom value must survive. Only an empty value uses the
    // protocol's default off behavior; non-off blanks default to the label.
    let explicit = !row.api_value.is_empty();
    let value = if explicit {
        row.api_value.as_str()
    } else if off {
        "none"
    } else {
        row.level.as_str()
    };
    if protocol == AiProtocol::Anthropic {
        let mut body = json!({"thinking":{"type": if off { "disabled" } else { "adaptive" }}});
        if !off || explicit {
            body["output_config"] = json!({"effort":value});
        }
        return body;
    }
    if preset_id == Some("deepseek") && protocol == AiProtocol::Completions {
        let mut body = json!({"thinking":{"type":if off {"disabled"} else {"enabled"}}});
        if !off || explicit {
            body["reasoning_effort"] = json!(value);
        }
        return body;
    }
    if preset_id == Some("openrouter") {
        return if off {
            if explicit {
                json!({"reasoning":{"enabled":false,"effort":value}})
            } else {
                json!({"reasoning":{"enabled":false}})
            }
        } else {
            json!({"reasoning":{"effort":value}})
        };
    }
    match protocol {
        AiProtocol::Completions => json!({"reasoning_effort":value}),
        AiProtocol::Responses => json!({"reasoning":{"effort":value}}),
        AiProtocol::Anthropic => unreachable!(),
    }
}

pub fn apply(
    options: &mut ChatOptions,
    protocol: AiProtocol,
    preset_id: Option<&str>,
    model: &AiModelConfig,
    requested: Option<&str>,
) -> AppResult<()> {
    let Some(row) = selected_level(model, requested)? else {
        return Ok(());
    };
    let body = if protocol == AiProtocol::Anthropic && legacy_anthropic_thinking(&model.id) {
        if row.level == "off" {
            if !row.api_value.is_empty() {
                return Err(AppError::new(
                    "ai_config_error",
                    "旧版 Claude 的 off 档位不接受 effort 参数值，请清空此档位的 API 参数值。",
                ));
            }
            json!({"thinking":{"type":"disabled"}})
        } else {
            let available = options
                .max_tokens
                .unwrap_or(model.max_output_tokens)
                .saturating_sub(1);
            if available < 1024 {
                return Err(AppError::new(
                    "ai_config_error",
                    "此 Claude 模型的思考预算至少为 1024 tokens，最大输出必须大于 1024。请增大最大输出或关闭推理等级。",
                ));
            }
            let configured = match row.api_value.as_str() {
                "" | "low" | "medium" | "high" if row.api_value.is_empty() || row.api_value == row.level => match row.level.as_str() { "low" => 1024, "high" => 8192, _ => 4096 },
                value => value.parse::<u32>().map_err(|_| AppError::new("ai_config_error", "此旧版 Claude 模型使用思考 token 预算，API 参数值须为至少 1024 的整数，或使用档位默认值。"))?,
            };
            if configured < 1024 {
                return Err(AppError::new(
                    "ai_config_error",
                    "Claude 思考 token 预算不能小于 1024。",
                ));
            }
            json!({"thinking":{"type":"enabled","budget_tokens":configured.min(available)}})
        }
    } else {
        payload(protocol, preset_id, row)
    };
    let extra = options.extra_body.get_or_insert_with(|| json!({}));
    for (key, value) in body.as_object().expect("reasoning payload").iter() {
        extra[key] = value.clone();
    }
    // Reasoning APIs often reject temperature. Leave sampling to the model.
    if row.level != "off" {
        options.temperature = None;
    }
    Ok(())
}

/// Only known legacy Claude IDs select the legacy capability; arbitrary gateway
/// aliases retain the configured protocol's adaptive mapping. No adapter inference.
pub fn legacy_anthropic_thinking(id: &str) -> bool {
    let id = id.rsplit('/').next().unwrap_or(id);
    [
        "claude-sonnet-4-5",
        "claude-sonnet-4.5",
        "claude-opus-4-5",
        "claude-opus-4.5",
        "claude-haiku-4-5",
        "claude-haiku-4.5",
        "claude-opus-4-1",
        "claude-opus-4.1",
        "claude-3-7-sonnet",
        "claude-3.7-sonnet",
    ]
    .iter()
    .any(|prefix| {
        id.strip_prefix(prefix)
            .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with('-'))
    }) || ["claude-sonnet-4", "claude-opus-4"].iter().any(|prefix| {
        id.strip_prefix(prefix).is_some_and(|suffix| {
            suffix.is_empty()
                || suffix
                    .strip_prefix('-')
                    .is_some_and(|date| date.len() == 8 && date.bytes().all(|b| b.is_ascii_digit()))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ai::default_reasoning_levels;
    #[test]
    fn legacy_claude_uses_a_valid_budget_instead_of_adaptive_thinking() {
        let mut model = AiModelConfig::from_id("claude-sonnet-4-5-20250929".into());
        model.reasoning_levels = default_reasoning_levels();
        model.reasoning_effort = Some("medium".into());
        let mut options = ChatOptions::default().with_max_tokens(2048);
        apply(
            &mut options,
            AiProtocol::Anthropic,
            Some("custom"),
            &model,
            None,
        )
        .unwrap();
        assert_eq!(
            options.extra_body.unwrap(),
            json!({"thinking":{"type":"enabled","budget_tokens":2047}})
        );
        let mut too_small = ChatOptions::default().with_max_tokens(1024);
        assert!(apply(&mut too_small, AiProtocol::Anthropic, None, &model, None).is_err());
        model.id = "claude-sonnet-4-6".into();
        let mut modern = ChatOptions::default().with_max_tokens(1024);
        apply(&mut modern, AiProtocol::Anthropic, None, &model, None).unwrap();
        assert_eq!(modern.extra_body.unwrap()["thinking"]["type"], "adaptive");
        assert!(!legacy_anthropic_thinking("custom-gateway-model"));
        assert!(!legacy_anthropic_thinking("claude-opus-4-7"));
        assert!(legacy_anthropic_thinking("claude-opus-4-20250514"));
    }
    #[test]
    fn configured_values_and_off_legacy_values_are_never_coerced() {
        let custom = AiReasoningLevel {
            level: "high".into(),
            api_value: "provider-special".into(),
        };
        assert_eq!(
            payload(AiProtocol::Completions, None, &custom)["reasoning_effort"],
            "provider-special"
        );
        assert_eq!(
            payload(AiProtocol::Responses, None, &custom)["reasoning"]["effort"],
            "provider-special"
        );
        assert_eq!(
            payload(AiProtocol::Anthropic, None, &custom)["output_config"]["effort"],
            "provider-special"
        );
        let off = AiReasoningLevel {
            level: "off".into(),
            api_value: "legacy-off-value".into(),
        };
        assert_eq!(
            payload(AiProtocol::Completions, None, &off)["reasoning_effort"],
            "legacy-off-value"
        );
        assert_eq!(
            payload(AiProtocol::Anthropic, None, &off)["output_config"]["effort"],
            "legacy-off-value"
        );
        let off = AiReasoningLevel {
            level: "off".into(),
            api_value: String::new(),
        };
        assert_eq!(
            payload(AiProtocol::Responses, None, &off)["reasoning"]["effort"],
            "none"
        );
        assert_eq!(
            payload(AiProtocol::Anthropic, None, &off),
            json!({"thinking":{"type":"disabled"}})
        );
        assert_eq!(
            payload(AiProtocol::Completions, Some("deepseek"), &off),
            json!({"thinking":{"type":"disabled"}})
        );
        assert_eq!(
            payload(AiProtocol::Completions, Some("openrouter"), &off),
            json!({"reasoning":{"enabled":false}})
        );
    }
    #[test]
    fn runtime_selection_uses_saved_mapping_and_preserves_other_request_fields() {
        let mut model = AiModelConfig::from_id("test".into());
        model.reasoning_levels = default_reasoning_levels();
        model.reasoning_effort = Some("medium".into());
        model.reasoning_levels[3].api_value = "deep".into();
        let mut options = ChatOptions::default()
            .with_extra_body(json!({"include":["reasoning.encrypted_content"]}));
        apply(
            &mut options,
            AiProtocol::Responses,
            Some("openai"),
            &model,
            Some("high"),
        )
        .unwrap();
        let body = options.extra_body.unwrap();
        assert_eq!(body["reasoning"]["effort"], "deep");
        assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
        assert!(selected_level(&model, Some("not-configured")).is_err());
        model.reasoning_levels.clear();
        model.reasoning_effort = None;
        let mut options = ChatOptions::default();
        apply(&mut options, AiProtocol::Completions, None, &model, None).unwrap();
        assert!(options.extra_body.is_none());
    }
}
