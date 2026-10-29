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
    let body = payload(protocol, preset_id, row);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ai::default_reasoning_levels;
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
