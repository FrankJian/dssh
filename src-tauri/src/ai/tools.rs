use std::time::Duration;

use genai::chat::Tool;
use serde_json::{Value, json};
use tokio::process::Command;

use crate::{app::AppState, models::ai::CurrentServer, ssh::run_ssh_command};

/// Maximum number of characters of command output threaded back to the model,
/// to keep the context bounded on chatty commands.
const MAX_OUTPUT_CHARS: usize = 12_000;

/// Number of trailing characters of terminal scrollback returned to the model.
/// The most recent output (e.g. an error at the bottom of the screen) matters
/// most, so we keep the tail.
const MAX_TERMINAL_TAIL_CHARS: usize = 8_000;

/// The tool set exposed to the model for SSH server operations.
pub fn tool_defs() -> Vec<Tool> {
    vec![
        Tool::new("list_servers")
            .with_description(
                "列出用户已保存的所有 SSH 服务器配置（返回 id、名称、主机、端口、用户名、标签、描述）。\
                 在需要选择或操作某台服务器之前，先调用此工具获取服务器的 id。",
            )
            .with_schema(json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            })),
        Tool::new("run_command")
            .with_description(
                "执行一条非交互式 shell 命令，并返回标准输出、标准错误和退出码。\
                 适合查询系统状态、查看日志、管理服务、读取文件等操作。\
                 命令在一个全新的、非登录的会话中执行，因此如需持久化环境请在同一条命令中完成\
                 （例如使用 `cd /path && ...`）。\n\
                 目标由 server_id 决定：提供已保存服务器的 id 时通过 SSH 在该远程服务器上执行；\
                 当用户当前处于【本地终端】且未指定 server_id（或 server_id 为 \"local\"）时，\
                 命令会在本地机器上执行。操作本地终端时无需先调用 list_servers。",
            )
            .with_schema(json!({
                "type": "object",
                "properties": {
                    "server_id": {
                        "type": "string",
                        "description": "目标服务器的 id（来自 list_servers 的返回结果）。\
                                        操作本地终端时可省略，或填 \"local\"。"
                    },
                    "command": {
                        "type": "string",
                        "description": "要执行的完整 shell 命令。"
                    },
                    "timeout_secs": {
                        "type": "integer",
                        "description": "命令的超时时间（秒），默认 30，最大 600。"
                    }
                },
                "required": ["command"],
                "additionalProperties": false
            })),
        Tool::new("open_ssh_session")
            .with_description(
                "请求打开一台已保存服务器的交互式 SSH 终端。必须先通过 list_servers 获取 server_id。\
                 该操作会向用户显示目标服务器信息并要求确认；确认后在应用中创建一个新的 SSH 终端标签。",
            )
            .with_schema(json!({
                "type": "object",
                "properties": {
                    "server_id": {
                        "type": "string",
                        "description": "要连接的已保存服务器 id（来自 list_servers）。"
                    }
                },
                "required": ["server_id"],
                "additionalProperties": false
            })),
        Tool::new("ask_user_question")
            .with_description(
                "向用户提出一个需要选择的问题。仅在无法从当前上下文确定目标时使用，例如让用户从多台服务器中选择。\
                 每次只问一个问题，提供 2 到 6 个清晰、可直接选择的选项。用户的选择会作为工具结果返回。",
            )
            .with_schema(json!({
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "展示给用户的简短问题。"
                    },
                    "options": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 6,
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "label": { "type": "string" },
                                "description": { "type": "string" }
                            },
                            "required": ["id", "label"],
                            "additionalProperties": false
                        }
                    },
                    "allow_multiple": {
                        "type": "boolean",
                        "description": "是否允许用户多选，默认 false。"
                    }
                },
                "required": ["question", "options"],
                "additionalProperties": false
            })),
        Tool::new("read_terminal")
            .with_description(
                "读取用户当前正在查看的交互式终端（黑窗口）中最近的输出内容，已去除 ANSI 颜色控制字符。\
                 当用户提到“刚才的报错、上面的输出、屏幕上的内容、这个错误”等，却没有把文本粘贴到对话里时，\
                 应调用此工具直接获取终端上可见的内容（尤其是报错信息），然后据此作答。\
                 默认读取用户当前的会话，通常无需提供 session_id。",
            )
            .with_schema(json!({
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "要读取的终端会话 id；省略时读取用户当前活动的会话。"
                    }
                },
                "additionalProperties": false
            })),
    ]
}

/// Whether a tool requires explicit user approval before executing.
pub fn tool_needs_approval(tool_name: &str) -> bool {
    matches!(tool_name, "run_command" | "open_ssh_session")
}

#[derive(Debug, Clone)]
pub struct OpenSshSessionRequest {
    pub profile_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

pub fn prepare_open_ssh_session(
    state: &AppState,
    args: &Value,
) -> Result<OpenSshSessionRequest, String> {
    let server_id = args
        .get("server_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "缺少参数 server_id：请先调用 list_servers 获取目标服务器的 id。".to_string()
        })?;
    let profile = state
        .profiles
        .get_profile(server_id)
        .map_err(|error| format!("读取服务器配置失败：{}", error.message))?
        .ok_or_else(|| {
            format!("找不到 id 为 {server_id} 的服务器，请先调用 list_servers 获取有效的 id。")
        })?;
    Ok(OpenSshSessionRequest {
        profile_id: profile.id,
        name: profile.name,
        host: profile.host,
        port: profile.port,
        username: profile.username,
    })
}

pub fn open_ssh_session_confirmation_args(state: &AppState, args: &Value) -> Value {
    let mut display_args = args.clone();
    if let (Ok(request), Some(object)) = (
        prepare_open_ssh_session(state, args),
        display_args.as_object_mut(),
    ) {
        object.insert(
            "server".to_string(),
            json!({
                "name": request.name,
                "host": request.host,
                "port": request.port,
                "username": request.username,
            }),
        );
    }
    display_args
}

/// Execute a tool call and return `(observation_text, is_error)`.
pub async fn execute_tool(
    state: &AppState,
    tool_name: &str,
    args: &Value,
    current: Option<&CurrentServer>,
) -> (String, bool) {
    match tool_name {
        "list_servers" => execute_list_servers(state),
        "run_command" => execute_run_command(state, args, current).await,
        "ask_user_question" => ("正在等待用户选择。".to_string(), false),
        "open_ssh_session" => ("SSH 连接请求正在由应用打开终端。".to_string(), false),
        "read_terminal" => {
            execute_read_terminal(state, args, current.and_then(|c| c.session_id.as_deref()))
        }
        other => (format!("未知的工具：{other}"), true),
    }
}

fn execute_list_servers(state: &AppState) -> (String, bool) {
    match state.profiles.list_profiles() {
        Ok(profiles) => {
            let summary: Vec<Value> = profiles
                .iter()
                .map(|profile| {
                    json!({
                        "id": profile.id,
                        "name": profile.name,
                        "host": profile.host,
                        "port": profile.port,
                        "username": profile.username,
                        "tags": profile.tags,
                        "description": profile.description,
                    })
                })
                .collect();
            let text = serde_json::to_string_pretty(&json!({ "servers": summary }))
                .unwrap_or_else(|_| "[]".to_string());
            (text, false)
        }
        Err(error) => (format!("读取服务器列表失败：{}", error.message), true),
    }
}

async fn execute_run_command(
    state: &AppState,
    args: &Value,
    current: Option<&CurrentServer>,
) -> (String, bool) {
    let command = match args.get("command").and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => value.to_string(),
        _ => return ("缺少参数 command。".to_string(), true),
    };
    let timeout_secs = args
        .get("timeout_secs")
        .and_then(Value::as_u64)
        .unwrap_or(30)
        .clamp(1, 600);

    let requested_server = args
        .get("server_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let current_is_local = current
        .and_then(|c| c.kind.as_deref())
        .map(|kind| kind == "local")
        .unwrap_or(false);

    // On a local terminal we treat the local machine as the target host: run the
    // command locally unless the model explicitly targets a saved remote server.
    let target_local = match requested_server {
        Some("local") => true,
        Some(_) => false,
        None => current_is_local,
    };
    if target_local {
        return run_local_command(&command, timeout_secs).await;
    }

    let server_id = match requested_server {
        Some(value) => value.to_string(),
        None => {
            return (
                "缺少参数 server_id：请先调用 list_servers 获取目标服务器的 id。".to_string(),
                true,
            );
        }
    };

    let profile = match state.profiles.get_profile(&server_id) {
        Ok(Some(profile)) => profile,
        Ok(None) => {
            return (
                format!("找不到 id 为 {server_id} 的服务器，请先调用 list_servers 获取有效的 id。"),
                true,
            );
        }
        Err(error) => return (format!("读取服务器配置失败：{}", error.message), true),
    };

    match run_ssh_command(profile, command, timeout_secs, state.host_keys.clone()).await {
        Ok(output) => {
            let mut body = String::new();
            body.push_str(&format!(
                "exit_code: {}\n",
                output
                    .exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            ));
            if output.timed_out {
                body.push_str("注意：命令执行超时，输出可能不完整。\n");
            }
            body.push_str("--- stdout ---\n");
            body.push_str(output.stdout.trim_end());
            body.push_str("\n--- stderr ---\n");
            body.push_str(output.stderr.trim_end());

            let is_error =
                output.timed_out || output.exit_code.map(|code| code != 0).unwrap_or(true);
            (truncate_output(&body), is_error)
        }
        Err(error) => (format!("命令执行失败：{}", error.message), true),
    }
}

/// Run a command on the local machine, used when the active terminal is a local
/// (non-SSH) terminal. Mirrors the observation format of the SSH path.
async fn run_local_command(command: &str, timeout_secs: u64) -> (String, bool) {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        #[cfg(windows)]
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    cmd.kill_on_drop(true);

    match tokio::time::timeout(Duration::from_secs(timeout_secs.max(1)), cmd.output()).await {
        Err(_) => (
            format!("命令在本地执行超时（>{timeout_secs}s），输出可能不完整。"),
            true,
        ),
        Ok(Err(error)) => (format!("本地命令执行失败：{error}"), true),
        Ok(Ok(output)) => {
            let code = output.status.code();
            let mut body = String::new();
            body.push_str(&format!(
                "exit_code: {}\n",
                code.map(|c| c.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            ));
            body.push_str("--- stdout ---\n");
            body.push_str(String::from_utf8_lossy(&output.stdout).trim_end());
            body.push_str("\n--- stderr ---\n");
            body.push_str(String::from_utf8_lossy(&output.stderr).trim_end());

            let is_error = code.map(|c| c != 0).unwrap_or(true);
            (truncate_output(&body), is_error)
        }
    }
}

fn execute_read_terminal(
    state: &AppState,
    args: &Value,
    current_session_id: Option<&str>,
) -> (String, bool) {
    let session_id = args
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| current_session_id.map(str::to_string));

    let session_id = match session_id {
        Some(value) => value,
        None => {
            return (
                "当前没有可读取的活动终端会话。请确认已打开一个 SSH 会话窗口。".to_string(),
                true,
            );
        }
    };

    match state.sessions.read_session_output(&session_id) {
        Ok(raw) => {
            let clean = strip_ansi(&raw);
            let trimmed = clean.trim();
            if trimmed.is_empty() {
                return ("当前终端还没有任何输出内容。".to_string(), false);
            }
            (tail_output(trimmed), false)
        }
        Err(error) => (format!("读取终端内容失败：{}", error.message), true),
    }
}

/// Remove ANSI/VT control sequences (CSI, OSC, single-char escapes) so the
/// model receives clean, readable text rather than color codes.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\u{001b}' => match chars.next() {
                // CSI: ESC [ ... <final byte 0x40-0x7E>
                Some('[') => {
                    for next in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&next) {
                            break;
                        }
                    }
                }
                // OSC: ESC ] ... terminated by BEL or ESC \
                Some(']') => {
                    while let Some(next) = chars.next() {
                        if next == '\u{0007}' {
                            break;
                        }
                        if next == '\u{001b}' {
                            if let Some('\\') = chars.peek() {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                // Other two-char escapes: drop the following byte.
                _ => {}
            },
            // Strip other C0 control chars except tab and newline.
            '\r' => {}
            '\u{0000}'..='\u{0008}' | '\u{000b}'..='\u{001f}' | '\u{007f}' => {}
            other => out.push(other),
        }
    }
    out
}

/// Keep only the trailing portion of long terminal output (recent lines).
fn tail_output(text: &str) -> String {
    let count = text.chars().count();
    if count <= MAX_TERMINAL_TAIL_CHARS {
        return text.to_string();
    }
    let start = count - MAX_TERMINAL_TAIL_CHARS;
    let tail: String = text.chars().skip(start).collect();
    format!("…（仅显示终端最近的内容）\n{tail}")
}

fn truncate_output(text: &str) -> String {
    if text.chars().count() <= MAX_OUTPUT_CHARS {
        return text.to_string();
    }
    let truncated: String = text.chars().take(MAX_OUTPUT_CHARS).collect();
    format!("{truncated}\n…（输出过长已截断）")
}

#[cfg(test)]
mod tests {
    use super::{tool_defs, tool_needs_approval};

    #[test]
    fn opening_an_ssh_session_requires_explicit_approval() {
        assert!(tool_needs_approval("open_ssh_session"));
        assert!(tool_needs_approval("run_command"));
        assert!(!tool_needs_approval("list_servers"));
    }

    #[test]
    fn ssh_open_tool_is_available_to_the_agent() {
        assert!(
            tool_defs()
                .iter()
                .any(|tool| tool.name == "open_ssh_session".into())
        );
    }
}
