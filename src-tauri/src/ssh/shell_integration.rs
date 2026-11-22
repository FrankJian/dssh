//! Opt-in hooks for the current shell only. Never executed during connection.
use crate::{
    error::{AppError, AppResult},
    models::terminal::ShellIntegrationShell,
};

pub(super) fn command(shell: &ShellIntegrationShell) -> String {
    let script = match shell {
        ShellIntegrationShell::Bash => include_str!("shell_integration/bash.sh"),
        ShellIntegrationShell::Zsh => include_str!("shell_integration/zsh.sh"),
    };
    encode_script(script)
}

fn encode_script(script: &str) -> String {
    // ANSI-C quoting is supported by both shells. No literal CR/LF/ESC occurs
    // before the single final Enter, so an installer is one canonical PTY line.
    // Windows checkouts may contain CRLF; those CRs are not shell source text.
    let encoded = script
        .replace("\r\n", "\n")
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\r', "\\r")
        .replace('\n', "\\n");
    format!(" builtin eval $'{encoded}'\r")
}

pub(super) fn validate_prompt(output: &str) -> AppResult<()> {
    let mut line = String::new();
    let mut state = 0;
    for ch in output.chars() {
        match (state, ch) {
            (0, '\u{1b}') => state = 1,
            (1, '[') => state = 2,
            (1, ']') => state = 3,
            (1, _) => state = 0,
            (2, '@'..='~') => state = 0,
            (2, _) => {}
            (3, '\u{7}') => state = 0,
            (3, '\u{1b}') => state = 4,
            (3, _) => {}
            (4, '\\') => state = 0,
            (4, _) => state = 3,
            (0, '\n') => line.clear(),
            (0, '\r') => {}
            (0, '\u{8}') => {
                line.pop();
            }
            (0, c) if !c.is_control() => {
                line.push(c);
                if line.len() > 2048 {
                    line.clear();
                }
            }
            _ => {}
        }
    }
    let lower = line.to_lowercase();
    let suffix = line.trim_end().chars().last();
    if state != 0
        || !matches!(suffix, Some('$' | '#' | '%' | '❯' | '➜'))
        || [
            "password",
            "passphrase",
            "verification",
            "otp",
            "密码",
            "口令",
            "验证码",
            "fingerprint",
        ]
        .iter()
        .any(|word| lower.contains(word))
    {
        return Err(AppError::new(
            "shell_integration_prompt",
            "请先返回 Bash/Zsh 的空白命令提示符，再启用命令识别。",
        ));
    }
    for mode in ["47", "1047", "1049"] {
        if let Some(entered) = output.rfind(&format!("\u{1b}[?{mode}h"))
            && output
                .rfind(&format!("\u{1b}[?{mode}l"))
                .is_none_or(|left| left < entered)
        {
            return Err(AppError::new(
                "shell_integration_prompt",
                "请先退出全屏程序，再启用命令识别。",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scripts_are_one_bounded_input_line_and_do_not_write_files() {
        for shell in [ShellIntegrationShell::Bash, ShellIntegrationShell::Zsh] {
            let input = command(&shell);
            assert!(input.len() < 3900);
            assert_eq!(
                input.chars().filter(|c| c.is_control()).collect::<String>(),
                "\r"
            );
            assert!(input.starts_with(" builtin eval $'"));
        }
    }
    #[test]
    fn windows_script_line_endings_encode_identically_to_unix() {
        for script in [
            include_str!("shell_integration/bash.sh"),
            include_str!("shell_integration/zsh.sh"),
        ] {
            let unix = script.replace("\r\n", "\n");
            let windows = unix.replace('\n', "\r\n");
            let input = encode_script(&windows);
            assert_eq!(input, encode_script(&unix));
            assert!(input.len() < 3900);
            assert_eq!(
                input.chars().filter(|c| c.is_control()).collect::<String>(),
                "\r"
            );
        }
    }

    #[test]
    fn standalone_carriage_return_is_quoted_instead_of_submitting_input() {
        assert_eq!(
            encode_script("printf 'a\rb'"),
            " builtin eval $'printf \\'a\\rb\\''\r"
        );
    }
    #[test]
    fn only_empty_shell_prompt_is_eligible_and_auth_and_tui_are_rejected() {
        for prompt in ["user@host:~$ ", "\x1b[32m[root@host ~]# \x1b[0m", "demo% "] {
            assert!(validate_prompt(prompt).is_ok());
        }
        for prompt in [
            "Password: ",
            "验证码: ",
            "Opt> ",
            "user$ ll",
            "working",
            "\x1b[?1049hdemo$ ",
        ] {
            assert!(validate_prompt(prompt).is_err());
        }
    }
}
