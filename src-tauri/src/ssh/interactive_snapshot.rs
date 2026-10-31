//! A guarded transaction on the already-selected JumpServer PTY. No new exec
//! channel, credentials, server-side files or guessed menu selections.
use std::{collections::HashMap, net::Ipv4Addr};

use tokio::sync::{oneshot, watch};

use crate::{
    error::{AppError, AppResult},
    models::server_snapshot::ServerSnapshotTarget,
    ssh::CommandOutput,
};

const MAX_CAPTURE: usize = 768 * 1024;

type Reply = oneshot::Sender<AppResult<CommandOutput>>;
pub struct CaptureReceivers {
    pub ready: oneshot::Receiver<String>,
    pub progress: watch::Receiver<usize>,
    pub result: oneshot::Receiver<AppResult<CommandOutput>>,
}

#[derive(Default)]
pub struct TerminalSnapshotState {
    jumpserver: bool,
    asset: Option<String>,
    pending_asset: Option<String>,
    assets: HashMap<String, String>,
    generation: u64,
    line: String,
    escape: u8,
    control: String,
    alternate: bool,
    editing: bool,
    ready: bool,
    input: String,
    prompt: String,
    capture: Option<Capture>,
}

struct Capture {
    token: String,
    phase: u8, // 0: preflight, 1: command echo, 2: data, 3: recovery
    pending: String,
    data: String,
    truncated: bool,
    ready: Option<oneshot::Sender<String>>,
    progress: watch::Sender<usize>,
    authorized: bool,
    reply: Option<Reply>,
    prompt: String,
    generation: u64,
}

fn shell_host(line: &str) -> Option<String> {
    let line = line.trim_end();
    if !line.ends_with(['#', '$', '%']) || line.len() > 1024 {
        return None;
    }
    let (_, rest) = line.rsplit_once('@')?;
    let host: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    (!host.is_empty()).then_some(host)
}
fn first_ip(line: &str) -> Option<String> {
    line.split(|c: char| !c.is_ascii_digit() && c != '.')
        .find_map(|s| {
            s.trim_matches('.')
                .parse::<Ipv4Addr>()
                .ok()
                .map(|ip| ip.to_string())
        })
}
fn authentication(line: &str) -> bool {
    let line = line.to_lowercase();
    [
        "password",
        "passphrase",
        "verification code",
        "otp",
        "mfa",
        "token:",
        "fingerprint",
        "yes/no",
        "密码",
        "口令",
        "验证码",
        "指纹",
    ]
    .iter()
    .any(|s| line.contains(s))
}

impl TerminalSnapshotState {
    pub fn from_username(username: &str) -> Self {
        let mut state = Self::default();
        if username.split('@').count() >= 3 {
            state.jumpserver = true;
        }
        state
    }
    fn set_asset(&mut self, asset: Option<String>) {
        if self.asset != asset {
            self.generation = self.generation.wrapping_add(1);
            self.asset = asset;
        }
    }
    pub fn target(&self, session_id: &str, transport_label: &str) -> ServerSnapshotTarget {
        let source = if self.jumpserver {
            "terminal"
        } else {
            "transport"
        };
        let reason = if !self.jumpserver {
            None
        } else if self.capture.is_some() {
            Some("当前终端仍在采集或等待恢复，请稍后重试；必要时在终端按 Ctrl+C。".into())
        } else if self.asset.is_none() {
            Some("请先在 JumpServer 菜单中选择资产并进入目标主机 shell。".into())
        } else if !self.ready || self.editing || self.alternate {
            Some("目标终端尚未空闲：请结束当前程序或输入，回到 shell 提示符后再采集。".into())
        } else {
            None
        };
        ServerSnapshotTarget {
            source,
            identity: if self.jumpserver {
                format!(
                    "{session_id}:{}:{}",
                    self.generation,
                    self.asset.as_deref().unwrap_or("menu")
                )
            } else {
                format!("{session_id}:transport")
            },
            label: if self.jumpserver {
                self.asset
                    .clone()
                    .unwrap_or_else(|| "JumpServer 选服菜单".into())
            } else {
                transport_label.into()
            },
            ready: reason.is_none(),
            reason,
        }
    }
    pub fn input_allowed(&self, data: &str) -> bool {
        self.capture.is_none() || data == "\x03"
    }
    pub fn observe_input(&mut self, data: &str) {
        if data == "\x03" && self.capture.is_some() {
            self.abort("snapshot_cancelled", "已取消当前终端的快照采集。".into());
        }
        self.ready = false;
        for c in data.chars() {
            match c {
                '\r' | '\n' => {
                    let choice = self.input.trim();
                    if let Ok(ip) = choice.parse::<Ipv4Addr>() {
                        self.pending_asset = Some(ip.to_string());
                    } else if let Some(ip) = self.assets.get(choice) {
                        self.pending_asset = Some(ip.clone());
                    }
                    self.input.clear();
                    self.line.clear();
                    self.editing = false;
                }
                '\x03' => {
                    self.input.clear();
                    self.editing = false;
                    self.line.clear();
                }
                '\x7f' | '\x08' => {
                    self.input.pop();
                    self.editing = true;
                }
                _ => {
                    self.editing = true;
                    if !c.is_control() && self.input.len() < 1024 {
                        self.input.push(c);
                    }
                }
            }
        }
    }
    pub fn begin(&mut self, token: String) -> CaptureReceivers {
        let (ready_tx, ready) = oneshot::channel();
        let (reply, result) = oneshot::channel();
        let (progress_tx, progress) = watch::channel(0);
        self.ready = false;
        self.capture = Some(Capture {
            token,
            phase: 0,
            pending: String::new(),
            data: String::new(),
            truncated: false,
            ready: Some(ready_tx),
            progress: progress_tx,
            authorized: false,
            reply: Some(reply),
            prompt: self.prompt.clone(),
            generation: self.generation,
        });
        CaptureReceivers {
            ready,
            progress,
            result,
        }
    }
    pub fn can_interrupt(&self) -> bool {
        self.capture.as_ref().is_some_and(|c| c.authorized)
    }
    pub fn owns(&self, token: &str) -> bool {
        self.capture
            .as_ref()
            .is_some_and(|c| c.token == token && c.phase != 3)
    }
    pub fn abort(&mut self, code: &str, message: String) {
        if let Some(capture) = self.capture.as_mut() {
            capture.reject(code, message);
        }
    }
    pub fn disconnected(&mut self) {
        self.abort(
            "snapshot_connection_lost",
            "连接已断开，请重新进入目标资产后采集。".into(),
        );
        self.capture = None;
        self.set_asset(None);
        self.ready = false;
        self.editing = false;
        self.line.clear();
        self.input.clear();
        self.pending_asset = None;
        self.assets.clear();
        self.alternate = false;
        self.escape = 0;
        self.control.clear();
        self.generation = self.generation.wrapping_add(1);
    }
    fn inspect_line(&mut self, line: &str) {
        let trimmed = line.trim();
        let menu = trimmed
            .get(..3)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("opt"))
            && matches!(trimmed.get(3..).map(str::trim), Some(">" | ":"));
        if menu {
            self.jumpserver = true;
            if self.asset.is_some() {
                self.assets.clear();
            }
            self.set_asset(None);
            self.pending_asset = None;
            self.ready = false;
            self.abort(
                "snapshot_target_changed",
                "JumpServer 已返回选服菜单，已停止采集。".into(),
            );
        }
        let starts = |prefix: &str| {
            trimmed
                .get(..prefix.len())
                .is_some_and(|part| part.eq_ignore_ascii_case(prefix))
        };
        let welcome = starts("welcome to") || trimmed.starts_with("欢迎使用");
        let named = trimmed
            .as_bytes()
            .windows(10)
            .any(|part| part.eq_ignore_ascii_case(b"jumpserver"));
        if starts("jumpserver") || starts("koko ") || welcome && named {
            self.jumpserver = true;
        }
        if self.jumpserver
            && self.asset.is_none()
            && let Some(ip) = first_ip(trimmed)
        {
            let id = trimmed
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(['.', ')']);
            if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
                self.assets.insert(id.into(), ip.clone());
            }
            let lower = trimmed.to_lowercase();
            if lower.contains("connect") || trimmed.contains("连接") {
                self.pending_asset = Some(ip);
            }
        }
    }
    fn observe_plain(&mut self, text: &str) {
        for c in text.chars() {
            match self.escape {
                1 => {
                    self.escape = match c {
                        '[' => 2,
                        ']' => 3,
                        _ => 0,
                    };
                    self.control.clear();
                }
                2 => {
                    if self.control.len() < 64 {
                        self.control.push(c);
                    }
                    if ('@'..='~').contains(&c) {
                        if ["?1049h", "?1047h", "?47h"].contains(&self.control.as_str()) {
                            self.alternate = true;
                        }
                        if ["?1049l", "?1047l", "?47l"].contains(&self.control.as_str()) {
                            self.alternate = false;
                        }
                        self.escape = 0;
                    }
                }
                3 => {
                    if c == '\x07' {
                        self.finish_title();
                    } else if c == '\x1b' {
                        self.escape = 4;
                    } else if self.control.len() < 512 {
                        self.control.push(c);
                    }
                }
                4 => {
                    if c == '\\' {
                        self.finish_title();
                    } else {
                        self.escape = 3;
                    }
                }
                _ => match c {
                    '\x1b' => self.escape = 1,
                    '\r' | '\n' => {
                        let line = self.line.clone();
                        self.inspect_line(&line);
                        self.line.clear();
                    }
                    '\x08' => {
                        self.line.pop();
                    }
                    _ if !c.is_control() => {
                        self.line.push(c);
                        if self.line.len() > 2048 {
                            self.line.clear();
                        }
                    }
                    _ => {}
                },
            }
        }
        let line = self.line.clone();
        self.inspect_line(&line);
        self.ready = !self.editing
            && !self.alternate
            && !authentication(&line)
            && shell_host(&line).is_some();
        if self.ready {
            if self.jumpserver && self.asset.is_none() {
                let asset = self.pending_asset.take().or_else(|| shell_host(&line));
                self.set_asset(asset);
            }
            self.prompt = line;
        }
    }
    fn finish_title(&mut self) {
        if let Some(title) = self
            .control
            .strip_prefix("2;")
            .or_else(|| self.control.strip_prefix("0;"))
            && let Some(authority) = title
                .strip_prefix("ssh://")
                .or_else(|| title.strip_prefix("telnet://"))
            && let Some((_, host)) = authority.rsplit_once('@')
        {
            let host = host.trim_end_matches('/');
            if !host.is_empty() && host.len() < 256 && !host.chars().any(char::is_whitespace) {
                self.jumpserver = true;
                self.set_asset(Some(host.into()));
            }
        }
        self.escape = 0;
        self.control.clear();
    }
    /// Return only visible terminal text. Framed probe output/echo goes directly
    /// to the request, never to xterm, retained history or AI terminal reads.
    pub fn output(&mut self, text: &str) -> String {
        let Some(mut capture) = self.capture.take() else {
            self.observe_plain(text);
            return text.into();
        };
        capture.pending.push_str(text);
        loop {
            let marker = match capture.phase {
                0 => format!("\x1eDSSH_{}_READY", capture.token),
                1 => format!("\x1eDSSH_{}_BEGIN\x1f", capture.token),
                _ => format!("\x1eDSSH_{}_END:", capture.token),
            };
            let more = format!("\x1eDSSH_{}_MORE\x1f", capture.token);
            let mut selected = marker.as_str();
            let mut found = capture.pending.find(&marker);
            if capture.phase == 1
                && let Some(index) = capture.pending.find(&more)
                && found.is_none_or(|current| index < current)
            {
                selected = &more;
                found = Some(index);
            }
            if let Some(start) = found {
                if capture.phase == 0 {
                    if let Some(end) = capture.pending[start + marker.len()..].find('\x1f') {
                        let end = start + marker.len() + end;
                        let codec = capture.pending[start + marker.len()..end]
                            .trim_start_matches(':')
                            .to_string();
                        if !["", "octal", "b64d", "b64D", "b64d-gzip", "b64D-gzip"]
                            .contains(&codec.as_str())
                        {
                            capture.reject(
                                "snapshot_protocol_error",
                                "采集握手格式不正确，未发送脚本。".into(),
                            );
                            self.capture = Some(capture);
                            return String::new();
                        }
                        let prefix: String = capture.pending.drain(..start).collect();
                        if let Some(visible) = self.capture_prefix(&mut capture, &prefix) {
                            return visible;
                        }
                        capture.pending.drain(..end - start + 1);
                        capture.phase = 1;
                        capture.authorized = true;
                        if let Some(ready) = capture.ready.take() {
                            let _ = ready.send(if codec.is_empty() {
                                "octal".into()
                            } else {
                                codec
                            });
                        }
                        continue;
                    }
                } else if capture.phase == 1 {
                    let length = selected.len();
                    let is_more = selected == more;
                    let prefix: String = capture.pending.drain(..start).collect();
                    if let Some(visible) = self.capture_prefix(&mut capture, &prefix) {
                        return visible;
                    }
                    capture.pending.drain(..length);
                    if is_more {
                        let next = *capture.progress.borrow() + 1;
                        capture.progress.send_replace(next);
                    } else {
                        capture.phase = 2;
                    }
                    continue;
                }
                if capture.phase >= 2
                    && let Some(end) = capture.pending[start + marker.len()..].find('\x1f')
                {
                    let end = start + marker.len() + end;
                    let code = capture.pending[start + marker.len()..end]
                        .parse::<u32>()
                        .unwrap_or(1);
                    let payload = capture.pending[..start].to_string();
                    capture.append(&payload);
                    let tail = capture.pending[end + 1..].to_string();
                    if let Some(reply) = capture.reply.take() {
                        let _ = reply.send(Ok(CommandOutput {
                            stdout: std::mem::take(&mut capture.data),
                            stderr: String::new(),
                            exit_code: Some(code),
                            timed_out: false,
                            output_truncated: capture.truncated,
                        }));
                    }
                    self.ready = false;
                    self.line.clear();
                    self.observe_plain(&tail);
                    return format!("\r\n{tail}");
                }
            }
            if let Some(start) = found
                && capture.pending.len() - start > selected.len() + 32
            {
                capture.reject(
                    "snapshot_protocol_error",
                    "采集分帧异常，已停止读取。".into(),
                );
                self.capture = Some(capture);
                return String::new();
            }
            // A possible split frame stays buffered. All other bytes are dealt
            // with now: menu changes are detected immediately, while data bytes
            // are never inspected as shell prompts or JumpServer menus.
            let mut keep = (1..marker.len())
                .rev()
                .find(|&n| capture.pending.ends_with(&marker[..n]))
                .unwrap_or(0);
            if capture.phase == 1 {
                keep = keep.max(
                    (1..more.len())
                        .rev()
                        .find(|&n| capture.pending.ends_with(&more[..n]))
                        .unwrap_or(0),
                );
            }
            let cut = found.unwrap_or(capture.pending.len() - keep);
            let prefix: String = capture.pending.drain(..cut).collect();
            if capture.phase == 2 {
                capture.append(&prefix);
            } else if let Some(visible) = self.capture_prefix(&mut capture, &prefix) {
                return visible;
            }
            self.capture = Some(capture);
            return String::new();
        }
    }
    fn capture_prefix(&mut self, capture: &mut Capture, prefix: &str) -> Option<String> {
        self.observe_plain(prefix);
        if self.generation != capture.generation {
            capture.reject(
                "snapshot_target_changed",
                "目标资产已变化，已停止采集。".into(),
            );
            return Some(format!("\r\n{}", self.line));
        }
        if capture.phase == 3 && self.ready && shell_host(&self.line) == shell_host(&capture.prompt)
        {
            return Some(format!("\r\n{}", self.line));
        }
        None
    }
}
impl Capture {
    fn reject(&mut self, code: &str, message: String) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err(AppError::new(code, message)));
        }
        self.ready.take();
        self.phase = 3;
        self.data.clear();
        self.pending.clear();
    }
    fn append(&mut self, text: &str) {
        let room = MAX_CAPTURE.saturating_sub(self.data.len());
        let mut end = text.len().min(room);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        self.data.push_str(&text[..end]);
        self.truncated |= end < text.len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn asset() -> TerminalSnapshotState {
        let mut state = TerminalSnapshotState::default();
        state.output("Welcome to JumpServer\r\n1) database 10.0.0.2\r\nOpt> ");
        state.observe_input("1\r");
        state.output("\r\nConnecting to 10.0.0.2\r\n[root@db ~]# ");
        state
    }
    #[test]
    fn menu_asset_and_shell_are_distinct_and_switching_changes_identity() {
        let mut state = asset();
        let first = state.target("s", "gateway");
        assert_eq!(first.source, "terminal");
        assert_eq!(first.label, "10.0.0.2");
        assert!(first.ready);
        state.output("\r\nOpt> ");
        assert!(!state.target("s", "gateway").ready);
        state.output("\r\n2) other 10.0.0.3\r\nOpt> ");
        state.observe_input("2\r");
        state.output("\r\n[root@other ~]# ");
        assert_eq!(state.target("s", "gateway").label, "10.0.0.3");
        assert_ne!(state.target("s", "gateway").identity, first.identity);
    }
    #[test]
    fn typed_input_long_running_commands_auth_and_tui_are_not_idle_shells() {
        let mut state = asset();
        state.observe_input("echo pending");
        assert!(!state.target("s", "gateway").ready);
        state.observe_input("\r");
        state.output("\x1b[0m");
        assert!(
            !state.target("s", "gateway").ready,
            "old prompt must not be reused"
        );
        state.output("\r\nPassword: ");
        assert!(!state.target("s", "gateway").ready);
        state.output("\r\n[root@db ~]# ");
        assert!(state.target("s", "gateway").ready);
        state.output("\x1b[?1049h[root@db ~]# ");
        assert!(!state.target("s", "gateway").ready);
        state.output("\x1b[?1049l\r\n[root@db ~]# ");
        assert!(state.target("s", "gateway").ready);
    }
    #[test]
    fn split_koko_title_identifies_the_asset_and_disconnect_does_not_fall_back_to_gateway() {
        let mut state = TerminalSnapshotState::default();
        state.output("\x1b]2;ssh://root@10.0.");
        state.output("0.9\x07\r\nroot@asset:~$ ");
        let initial = state.target("s", "gateway");
        assert_eq!(initial.source, "terminal");
        assert_eq!(initial.label, "10.0.0.9");
        state.disconnected();
        let next = state.target("s", "gateway");
        assert_eq!(next.source, "terminal");
        assert!(!next.ready);
        assert_ne!(initial.identity, next.identity);
    }
    #[tokio::test]
    async fn framed_output_is_collected_across_every_packet_boundary_without_echo_or_prompt() {
        let wire = "command echo\r\n\x1eDSSH_abc_READY\x1f\r\n[root@db ~]# echo\r\n\x1eDSSH_abc_BEGIN\x1f\r\n@@DSSH:HOST\r\n目标主机\r\nOpt> \r\n@@DSSH:END\r\n\x1eDSSH_abc_END:0\x1f\r\n[root@db ~]# ";
        for split in wire.char_indices().map(|(i, _)| i).skip(1) {
            let mut state = asset();
            let receivers = state.begin("abc".into());
            let mut visible = state.output(&wire[..split]);
            visible.push_str(&state.output(&wire[split..]));
            receivers.ready.await.unwrap();
            let result = receivers.result.await.unwrap().unwrap();
            assert!(result.stdout.contains("目标主机"));
            assert!(!result.stdout.contains("command echo"));
            assert!(!result.stdout.contains("[root@db"));
            assert!(!visible.contains("@@DSSH"));
            assert!(visible.contains("[root@db"));
            assert!(state.target("s", "gateway").ready);
        }
    }
    #[tokio::test]
    async fn menu_during_preflight_cancels_and_never_authorizes_the_payload() {
        let mut state = asset();
        let receivers = state.begin("abc".into());
        state.output("\r\nOpt> ");
        assert!(receivers.ready.await.is_err());
        assert_eq!(
            receivers.result.await.unwrap().unwrap_err().code,
            "snapshot_target_changed"
        );
        assert!(!state.owns("abc"));
    }
    #[tokio::test]
    async fn cancellation_keeps_input_guard_until_original_prompt_returns() {
        let mut state = asset();
        let receivers = state.begin("abc".into());
        state.output("\x1eDSSH_abc_READY\x1f\x1eDSSH_abc_BEGIN\x1f");
        state.observe_input("\x03");
        assert!(!state.input_allowed("exit\r"));
        assert_eq!(
            receivers.result.await.unwrap().unwrap_err().code,
            "snapshot_cancelled"
        );
        state.output("^C\r\n[root@db ~]# ");
        assert!(state.input_allowed("exit\r"));
        assert!(state.target("s", "gateway").ready);
    }
    #[tokio::test]
    async fn capture_limit_is_bounded_but_end_frame_is_still_recognized() {
        let mut state = asset();
        let receivers = state.begin("abc".into());
        state.output("\x1eDSSH_abc_READY\x1f\x1eDSSH_abc_BEGIN\x1f");
        state.output(&"x".repeat(MAX_CAPTURE + 1024));
        state.output("\x1eDSSH_abc_END:0\x1f");
        let result = receivers.result.await.unwrap().unwrap();
        assert!(result.output_truncated);
        assert!(result.stdout.len() <= MAX_CAPTURE);
    }
}
