//! Interactive terminal input reuses the owned PTY, never a new SSH exec channel.
use super::tools::{strip_ansi, tail_output};
use crate::models::terminal::TerminalInputEvent;
use crate::{
    app::AppState, models::ai::CurrentServer, ssh::session_manager::TerminalInputSnapshot,
};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

pub struct PreparedTerminalInput {
    session_id: String,
    label: String,
    input: String,
    snapshot: TerminalInputSnapshot,
    wait_ms: u64,
    conversation: String,
    background: bool,
}

impl PreparedTerminalInput {
    pub fn confirmation_args(&self) -> Value {
        json!({"session_id": self.session_id, "terminal": self.label, "input": self.input, "press_enter": true})
    }

    pub async fn execute(self, state: &AppState, app: &AppHandle) -> (String, bool) {
        let data = format!("{}\r", self.input);
        if let Err(error) = state.sessions.write_approved_input(
            &self.session_id,
            &self.conversation,
            &self.snapshot,
            data.clone(),
            || {
                if self.background {
                    return;
                }
                let _ = app.emit(
                    "terminal-input-observed",
                    TerminalInputEvent {
                        session_id: self.session_id.clone(),
                        data,
                    },
                );
            },
        ) {
            return (error.message, true);
        }
        tokio::time::sleep(std::time::Duration::from_millis(self.wait_ms)).await;
        match state.sessions.read_session_output(&self.session_id) {
            Ok(output) => {
                let changed = output != self.snapshot.output;
                let output = output
                    .strip_prefix(&self.snapshot.output)
                    .unwrap_or(&output);
                let clean = strip_ansi(output);
                (json!({
                    "session_id": self.session_id,
                    "input_sent": true,
                    "output_changed": changed,
                    "output": tail_output(clean.trim()),
                    "note": "内容已提交到同一交互终端；这不代表目标已连接或命令执行成功。请根据输出确认；若仍在连接或没有新输出，用 read_terminal 的 wait_ms 继续等待。",
                }).to_string(), false)
            }
            Err(_) => (
                "输入已提交，但终端已关闭或无法读取后续输出；不能据此认定连接成功。".into(),
                true,
            ),
        }
    }
}

pub fn prepare_input(
    state: &AppState,
    args: &Value,
    current: Option<&CurrentServer>,
    conversation: &str,
) -> Result<PreparedTerminalInput, String> {
    let input = validate_input(
        args.get("input")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )?;
    let session_id = args
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .or_else(|| current.and_then(|c| c.session_id.as_deref()))
        .ok_or("尚未指定终端，请用 open_ssh_session 建立后台会话，或通过 list_terminal_sessions 获取会话 ID。")?;
    let session = state
        .sessions
        .list_ai_sessions(conversation)
        .map_err(|_| "无法读取活动终端。")?
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or("指定终端不存在或已关闭。")?;
    state
        .sessions
        .check_ai_access(session_id, conversation, true)
        .map_err(|error| error.message)?;
    let snapshot = state
        .sessions
        .read_input_snapshot(session_id)
        .map_err(|error| error.message)?;
    validate_prompt(&strip_ansi(&snapshot.output))?;
    let wait_ms = args
        .get("wait_ms")
        .and_then(Value::as_u64)
        .unwrap_or(2000)
        .clamp(200, 10_000);
    Ok(PreparedTerminalInput {
        session_id: session.id,
        label: session.title,
        input,
        snapshot,
        wait_ms,
        conversation: conversation.into(),
        background: state.sessions.is_background(session_id),
    })
}

fn validate_input(input: &str) -> Result<String, String> {
    if input.trim().is_empty()
        || input.chars().count() > 1024
        || input.chars().any(char::is_control)
    {
        return Err("终端输入须为 1–1024 个字符的单行文本，不能包含回车、换行或控制序列；工具会自动按一次回车。".into());
    }
    Ok(input.to_string())
}

fn validate_prompt(output: &str) -> Result<(), String> {
    let prompt = output
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .to_lowercase();
    if [
        "password",
        "passphrase",
        "verification code",
        "one-time",
        "otp",
        "mfa",
        "token:",
        "authentication code",
        "fingerprint",
        "authenticity of host",
        "(yes/no",
        "主机密钥",
        "指纹",
        "密码",
        "口令",
        "验证码",
        "动态码",
    ]
    .iter()
    .any(|word| prompt.contains(word))
    {
        return Err("当前终端正在请求认证信息或主机信任确认，请由用户在终端中手动完成；不要让模型输入或获取密码、验证码或代为信任主机。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interactive_input_is_one_line_and_never_an_escape_sequence() {
        for value in ["10.20.30.40", "1", "root", "hostname", "ip addr"] {
            assert_eq!(validate_input(value).unwrap(), value);
        }
        for value in [
            "",
            "  ",
            "10.0.0.1\nrm -rf /",
            "1\r",
            "\x1b[A",
            "\x03",
            "a\t2",
            &"x".repeat(1025),
        ] {
            assert!(validate_input(value).is_err());
        }
    }
    #[test]
    fn authentication_prompts_require_the_user_but_old_banners_do_not_block_menu_input() {
        for prompt in [
            "Password: ",
            "Enter OTP:",
            "请输入验证码：",
            "Key passphrase:",
            "MFA code:",
            "Enter token:",
            "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
        ] {
            assert!(validate_prompt(prompt).is_err());
        }
        for prompt in [
            "JumpServer\nOpt> ",
            "Select account> ",
            "密码认证成功\nOpt> ",
            "[root@target ~]# ",
        ] {
            assert!(validate_prompt(prompt).is_ok());
        }
    }
}
