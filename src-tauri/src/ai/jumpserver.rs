//! JumpServer asset discovery and approved terminal connections.
use genai::chat::Tool;
use serde_json::{Value, json};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    jumpserver::api::PAGE_SIZE,
    models::jumpserver::{JumpServerQuery, JumpServerTarget},
};

pub(super) fn tool_defs() -> Vec<Tool> {
    vec![
        Tool::new("list_jumpserver_platforms")
            .with_description("列出已配置的 JumpServer 平台及 API 登录状态。用户明确要求查询或操作 JumpServer 资产时使用。")
            .with_schema(json!({"type":"object","properties":{},"additionalProperties":false})),
        Tool::new("search_jumpserver_assets")
            .with_description("通过已登录的 JumpServer API 搜索当前组织授权的资产，search 可填名称或 IP；按 next_offset 翻页。")
            .with_schema(json!({"type":"object","properties":{
                "platform_id":{"type":"string"},
                "search":{"type":"string"},
                "offset":{"type":"integer","minimum":0,"maximum":1000000}
            },"required":["platform_id"],"additionalProperties":false})),
        Tool::new("list_jumpserver_accounts")
            .with_description("查询指定资产授权的 SSH 账号。仅 supported=true 的账号可以通过 API 直连。")
            .with_schema(json!({"type":"object","properties":{
                "platform_id":{"type":"string"},"asset_id":{"type":"string"}
            },"required":["platform_id","asset_id"],"additionalProperties":false})),
        Tool::new("open_jumpserver_asset")
            .with_description("经用户确认后，使用指定授权账号直连 JumpServer SSH 资产，返回后台 terminal session_id。asset_id 来自资产搜索，account_alias 来自账号查询。后续通过该 session_id 使用 read_terminal 或 write_terminal。")
            .with_schema(json!({"type":"object","properties":{
                "platform_id":{"type":"string"},"asset_id":{"type":"string"},"account_alias":{"type":"string"}
            },"required":["platform_id","asset_id","account_alias"],"additionalProperties":false})),
    ]
}

pub(super) fn require_unlocked(state: &AppState) -> AppResult<()> {
    if state.app_lock.status()?.locked {
        Err(AppError::new("jumpserver_locked", "请先解锁 Duo SSH。"))
    } else {
        Ok(())
    }
}

pub(super) fn field<'a>(args: &'a Value, key: &str) -> AppResult<&'a str> {
    args[key]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::new("jumpserver_invalid", format!("请提供 {key}。")))
}

pub(super) fn list_platforms(state: &AppState) -> (String, bool) {
    let list = || -> AppResult<Value> {
        require_unlocked(state)?;
        let profiles = state.profiles.list_jumpserver_profiles()?;
        let mut platforms = Vec::new();
        for profile in profiles {
            let logged_in = state.jumpserver.identity(&profile.id)?.is_some();
            platforms.push(json!({"id": profile.id, "name": profile.name, "logged_in": logged_in}));
        }
        Ok(json!({"platforms": platforms}))
    };
    observation(list())
}

pub(super) fn observation(result: AppResult<Value>) -> (String, bool) {
    match result {
        Ok(value) => (value.to_string(), false),
        Err(error) => (error.message, true),
    }
}

pub(super) async fn discover(
    state: &AppState,
    tool: &str,
    args: &Value,
    generation: String,
) -> AppResult<Value> {
    let platform_id = field(args, "platform_id")?;
    let result = match tool {
        "search_jumpserver_assets" => {
            let offset = match args.get("offset") {
                None => 0,
                Some(value) => value
                    .as_u64()
                    .and_then(|offset| u32::try_from(offset).ok())
                    .ok_or_else(|| {
                        AppError::new("jumpserver_invalid", "offset 必须为非负整数。")
                    })?,
            };
            let page = state
                .jumpserver
                .assets(JumpServerQuery {
                    profile_id: platform_id.to_owned(),
                    generation,
                    search: args["search"]
                        .as_str()
                        .unwrap_or_default()
                        .trim()
                        .to_owned(),
                    offset,
                    node_id: None,
                })
                .await?;
            json!({"assets": page.results, "count": page.count, "next_offset": page.has_more.then_some(offset + PAGE_SIZE)})
        }
        "list_jumpserver_accounts" => {
            let accounts = state
                .jumpserver
                .accounts(platform_id, &generation, field(args, "asset_id")?)
                .await?;
            json!({"accounts": accounts})
        }
        _ => {
            return Err(AppError::new(
                "jumpserver_invalid",
                "未知的 JumpServer 查询工具。",
            ));
        }
    };
    require_unlocked(state)?;
    Ok(result)
}

pub(super) async fn prepare_target(
    state: &AppState,
    args: &Value,
    generation: String,
) -> AppResult<JumpServerTarget> {
    let target = state
        .jumpserver
        .resolve_ssh_target(
            field(args, "platform_id")?,
            &generation,
            field(args, "asset_id")?,
            field(args, "account_alias")?,
        )
        .await?;
    require_unlocked(state)?;
    Ok(target)
}

pub(super) fn register_target(
    state: &AppState,
    target: JumpServerTarget,
) -> AppResult<crate::models::ssh_profile::SshProfile> {
    require_unlocked(state)?;
    state.jumpserver.register_target(target)
}
