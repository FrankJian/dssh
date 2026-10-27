use std::time::Duration;

use russh::ChannelMsg;

use super::ConnectionLease;

pub const SETUP_START: &str = "\x1b]633;DsshSetupStart\x07";

/// A restored/detached terminal must not replay initialization source as commands.
pub fn strip_setup_echo(mut output: &str) -> String {
    let mut visible = String::new();
    while let Some(start) = output.find(SETUP_START) {
        let before = &output[..start];
        let after = &output[start + SETUP_START.len()..];
        if let Some(next_start) = after.find(SETUP_START)
            && after
                .find("\x1b]633;DsshReady;")
                .is_none_or(|ready| next_start < ready)
        {
            visible.push_str(before);
            visible.push_str(&after[..next_start]);
            output = &after[next_start..];
            continue;
        }
        let Some(ready) = after.find("\x1b]633;DsshReady;") else {
            visible.push_str(before);
            visible.push_str(after);
            return visible;
        };
        let acknowledgment = &after[ready..];
        let Some(end) = acknowledgment.find('\x07') else {
            visible.push_str(before);
            visible.push_str(after);
            return visible;
        };
        // The live renderer replaces this original prompt with the fresh prompt.
        let prompt_start = before.rfind('\n').map_or(0, |index| index + 1);
        visible.push_str(&before[..prompt_start]);
        output = &acknowledgment[end + 1..];
    }
    visible.push_str(output);
    visible
}

/// Only shell executables that have an explicit exit-status integration.
pub fn shell_kind(program: &str) -> Option<&'static str> {
    let name = program
        .trim()
        .rsplit(['/', '\\'])
        .next()?
        .to_ascii_lowercase();
    match name.trim_end_matches(".exe").trim_start_matches('-') {
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        "pwsh" | "powershell" => Some("powershell"),
        "sh" | "dash" | "ash" | "ksh" | "ksh93" => Some("posix"),
        _ => None,
    }
}

fn shell_from_probe(output: &[u8]) -> Option<&'static str> {
    let output = std::str::from_utf8(output).ok()?;
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("__DSSH_SHELL__:")
            .and_then(shell_kind)
            .or_else(|| {
                let path = line
                    .trim()
                    .strip_prefix("__DSSH_PS__:")?
                    .to_ascii_lowercase();
                ((path.starts_with('/') || path.as_bytes().get(1) == Some(&b':'))
                    && path
                        .split(['/', '\\'])
                        .any(|part| matches!(part, "powershell" | "windowspowershell")))
                .then_some("powershell")
            })
    })
}

/// Probe on a short-lived pooled channel, never by typing into the user's PTY.
/// Restricted servers can refuse exec: their normal shell still opens unchanged.
pub async fn detect_remote_shell(transport: &ConnectionLease) -> Option<&'static str> {
    let (mut channel, _permit) = tokio::time::timeout(
        Duration::from_millis(1200),
        transport.open_session_channel(),
    )
    .await
    .ok()?
    .ok()?;
    let result = tokio::time::timeout(Duration::from_millis(1200), async {
        channel
            .exec(true, "echo __DSSH_SHELL__:$SHELL; echo __DSSH_PS__:$PSHOME")
            .await
            .ok()?;
        let mut output = Vec::new();
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    if output.len() + data.len() > 1024 {
                        return None;
                    }
                    output.extend_from_slice(&data);
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        shell_from_probe(&output)
    })
    .await
    .ok()
    .flatten();
    let _ = tokio::time::timeout(Duration::from_millis(200), channel.close()).await;
    result
}

#[cfg(test)]
mod tests {
    use super::{SETUP_START, shell_from_probe, shell_kind, strip_setup_echo};

    #[test]
    fn restored_scrollback_hides_completed_setup_but_preserves_errors_and_user_output() {
        let output = format!(
            "hello\r\n$ {SETUP_START}setup source echo\r\n\x1b]633;DsshReady;bash\x07$ echo user\r\nuser\r\n$ "
        );
        assert_eq!(
            strip_setup_echo(&output),
            "hello\r\n$ echo user\r\nuser\r\n$ "
        );
        assert_eq!(
            strip_setup_echo(&format!("$ {SETUP_START}setup failed\r\n$ ")),
            "$ setup failed\r\n$ "
        );
        assert_eq!(
            strip_setup_echo("ordinary terminal output"),
            "ordinary terminal output"
        );
    }

    #[test]
    fn classifies_supported_shells_without_guessing_from_arbitrary_output() {
        for (program, expected) in [
            ("/bin/bash", "bash"),
            ("/bin/zsh", "zsh"),
            ("/usr/local/bin/fish", "fish"),
            ("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "powershell"),
            ("powershell.exe", "powershell"),
            ("/bin/dash", "posix"),
            ("/bin/ksh", "posix"),
        ] {
            assert_eq!(shell_kind(program), Some(expected));
        }
        assert_eq!(
            shell_from_probe(b"__DSSH_SHELL__:/bin/fish\r\n\r\n"),
            Some("fish")
        );
        assert_eq!(
            shell_from_probe(b"\r\n__DSSH_PS__:C:\\Windows\\System32\\WindowsPowerShell\\v1.0\r\n"),
            Some("powershell")
        );
        assert_eq!(
            shell_from_probe(b"\r\n__DSSH_PS__:C:\\Program Files\\PowerShell\\7\r\n"),
            Some("powershell")
        );
        assert_eq!(shell_from_probe(b"$SHELL; echo $PSHOME\r\n"), None);
        assert_eq!(shell_from_probe(b"restricted gateway menu"), None);
        assert_eq!(shell_from_probe(b"/bin/bash"), None);
        assert_eq!(shell_kind("cmd.exe"), None);
    }
}
