use std::{io::Write, time::Duration};

use flate2::{Compression, write::GzEncoder};

use base64::{Engine, engine::general_purpose::STANDARD};

use crate::{
    error::{AppError, AppResult},
    ssh::{CommandOutput, SessionManager},
};

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// All code is fixed in the backend. The frame nonce is random hex, never user input.
pub(crate) fn script(_token: &str) -> String {
    let system = include_str!("snapshot.sh");
    let disks = include_str!("snapshot-disks.sh");
    let docker = include_str!("snapshot-docker.sh");
    let configs = serde_json::to_vec(&[
        (system, 15, 256 * 1024),
        (disks, 15, 256 * 1024),
        (docker, 5, 128 * 1024),
    ])
    .expect("fixed probe configuration serializes");
    let encoded = STANDARD.encode(configs);
    format!(
        r#"if command -v python3 >/dev/null 2>&1 && python3 -I -c 'import selectors, subprocess' >/dev/null 2>&1; then
  python3 -I -c {python} {encoded}
  snapshot_rc=$?
else
  snapshot_run() {{
    if command -v timeout >/dev/null 2>&1; then timeout "$1" sh -c "$2"; else sh -c "$2"; fi
  }}
  snapshot_rc=0
  snapshot_run 15 {system} || snapshot_rc=1
  snapshot_run 15 {disks} || snapshot_rc=1
  snapshot_run 5 {docker} || printf '\n@@DSSH:DOCKER_WARNING\nDocker 采集失败。\n'
  printf '\n@@DSSH:END\n'
fi
exit "$snapshot_rc"
"#,
        python = quote(include_str!("snapshot-terminal.py")),
        encoded = quote(&encoded),
        system = quote(system),
        disks = quote(disks),
        docker = quote(docker)
    )
}

/// The temporary loader owns stdin on the selected asset. Each payload line is
/// acknowledged before the next is sent, preventing canonical-PTY input loss.
/// Compression uses the same lightweight crate already used by SSH compression.
pub(crate) fn preflight(token: &str) -> String {
    let loader = format!(
        r#"ds_c=octal; if command -v base64 >/dev/null 2>&1; then if base64 -d </dev/null >/dev/null 2>&1; then ds_c=b64d; elif base64 -D </dev/null >/dev/null 2>&1; then ds_c=b64D; fi; fi; if [ "$ds_c" != octal ] && command -v gzip >/dev/null 2>&1; then ds_c=$ds_c-gzip; fi; printf '\036DSSH_{token}_READY:%s\037' "$ds_c"; ds_d=; ds_ok=0; while IFS= read -r ds_l; do case "$ds_l" in DSSH_{token}_DONE:*) ds_n=${{ds_l#DSSH_{token}_DONE:}}; case "$ds_n" in ''|*[!0-9]*) ;; *) [ "${{#ds_d}}" -eq "$ds_n" ] && ds_ok=1 ;; esac; break ;; DSSH_{token}_DATA:*) ds_d=$ds_d${{ds_l#DSSH_{token}_DATA:}}; [ "${{#ds_d}}" -le 200000 ] || break; printf '\036DSSH_{token}_MORE\037' ;; *) break ;; esac; done; printf '\036DSSH_{token}_BEGIN\037\n'; ds_r=1; if [ "$ds_ok" = 1 ]; then case "$ds_c" in b64d-gzip) printf %s "$ds_d" | base64 -d | gzip -dc | sh 2>/dev/null ;; b64D-gzip) printf %s "$ds_d" | base64 -D | gzip -dc | sh 2>/dev/null ;; b64d) printf %s "$ds_d" | base64 -d | sh 2>/dev/null ;; b64D) printf %s "$ds_d" | base64 -D | sh 2>/dev/null ;; *) printf %b "$ds_d" | sh 2>/dev/null ;; esac; ds_r=$?; fi; printf '\036DSSH_{token}_END:%s\037\n' "$ds_r";"#
    );
    format!(" sh -c {}\r", quote(&loader))
}

pub(crate) fn input_lines(script: &str, codec: &str, token: &str) -> Vec<String> {
    let encoded = if codec.ends_with("-gzip") {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder
            .write_all(script.as_bytes())
            .expect("in-memory compression");
        STANDARD.encode(encoder.finish().expect("in-memory compression"))
    } else if codec.starts_with("b64") {
        STANDARD.encode(script.as_bytes())
    } else {
        script
            .as_bytes()
            .iter()
            .map(|b| format!("\\0{b:03o}"))
            .collect()
    };
    let mut lines: Vec<String> = encoded
        .as_bytes()
        .chunks(512)
        .map(|chunk| {
            format!(
                "DSSH_{token}_DATA:{}\r",
                std::str::from_utf8(chunk).expect("ASCII transport")
            )
        })
        .collect();
    lines.push(format!("DSSH_{token}_DONE:{}\r", encoded.len()));
    lines
}

pub async fn snapshot(
    sessions: &SessionManager,
    session_id: &str,
    identity: &str,
) -> AppResult<CommandOutput> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
    let token = format!("{:032x}", rand::random::<u128>());
    let preflight = preflight(&token);
    let receivers = sessions.begin_terminal_snapshot(session_id, identity, &token, preflight)?;
    let mut result = receivers.result;
    // Nothing large is sent until a shell actually executes the short preflight.
    // Menus, authentication prompts and a changed asset can never authorize it.
    let codec = match tokio::time::timeout(Duration::from_secs(4), receivers.ready).await {
        Ok(Ok(codec)) => codec,
        _ => {
            let reason = "未确认目标 shell 已准备好；没有发送采集脚本。请检查终端，必要时按 Ctrl+C 回到提示符后重试。";
            sessions.abort_terminal_snapshot(session_id, &token, reason);
            return result
                .try_recv()
                .unwrap_or_else(|_| Err(AppError::new("snapshot_terminal_not_ready", reason)));
        }
    };
    let mut progress = receivers.progress;
    let load_deadline = deadline.min(tokio::time::Instant::now() + Duration::from_secs(20));
    let lines = input_lines(&script(&token), &codec, &token);
    let last = lines.len() - 1;
    for (index, line) in lines.into_iter().enumerate() {
        if let Err(error) = sessions.queue_snapshot_line(session_id, &token, line) {
            sessions.abort_terminal_snapshot(session_id, &token, &error.message);
            let _ = sessions.cancel_terminal_snapshot(session_id, identity);
            return Err(error);
        }
        if index != last
            && !matches!(
                tokio::time::timeout_at(
                    load_deadline.min(tokio::time::Instant::now() + Duration::from_secs(4)),
                    progress.wait_for(|count| *count > index)
                )
                .await,
                Ok(Ok(_))
            )
        {
            let message = "当前终端没有确认收到完整采集脚本，已停止发送。请返回提示符后重试。";
            sessions.abort_terminal_snapshot(session_id, &token, message);
            let _ = sessions.cancel_terminal_snapshot(session_id, identity);
            return Err(AppError::new("snapshot_send_failed", message));
        }
    }
    match tokio::time::timeout_at(deadline, result).await {
        Ok(Ok(output)) => {
            if output.is_err() {
                let _ = sessions.cancel_terminal_snapshot(session_id, identity);
            }
            output
        }
        Ok(Err(_)) => Err(AppError::new(
            "snapshot_connection_lost",
            "采集期间终端已关闭。",
        )),
        Err(_) => {
            let message =
                "当前终端采集超时，已停止自动刷新。请检查终端，必要时按 Ctrl+C 恢复提示符。";
            sessions.abort_terminal_snapshot(session_id, &token, message);
            let _ = sessions.cancel_terminal_snapshot(session_id, identity);
            Err(AppError::new("snapshot_terminal_timeout", message))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_input_lines_are_short_and_contain_no_embedded_submission() {
        let lines = input_lines(&script("abc"), "b64d-gzip", "abc");
        assert!(lines.len() >= 2);
        assert!(preflight("a").len() < 3072);
        for line in lines {
            assert!(line.len() < 768);
            assert!(line.ends_with('\r'));
            assert!(!line[..line.len() - 1].chars().any(char::is_control));
        }
    }

    #[cfg(unix)]
    #[test]
    fn loader_roundtrips_unicode_quotes_and_shell_metacharacters() {
        use std::{
            io::{Read, Write},
            process::{Command, Stdio},
        };
        fn frame(reader: &mut impl Read) -> String {
            let mut out = Vec::new();
            let mut b = [0];
            while reader.read(&mut b).unwrap() > 0 {
                out.push(b[0]);
                if b[0] == 31 {
                    break;
                }
            }
            String::from_utf8(out).unwrap()
        }
        let source = "printf '%s' '中文 \" quote $() ; \\ *'\n";
        let directory = std::env::temp_dir().join(format!(
            "dssh-snapshot-loader-{:032x}",
            rand::random::<u128>()
        ));
        std::fs::create_dir(&directory).unwrap();
        std::os::unix::fs::symlink("/bin/sh", directory.join("sh")).unwrap();
        for minimal_path in [false, true] {
            let mut command = Command::new("/bin/sh");
            if minimal_path {
                command.env("PATH", &directory);
            }
            let mut child = command
                .arg("-c")
                .arg(preflight("unit").trim_end_matches('\r'))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let mut input = child.stdin.take().unwrap();
            let mut output = child.stdout.take().unwrap();
            let ready = frame(&mut output);
            let codec = ready
                .split("READY:")
                .nth(1)
                .unwrap()
                .trim_end_matches('\x1f');
            if minimal_path {
                assert_eq!(codec, "octal");
            }
            let lines = input_lines(source, codec, "unit");
            let last = lines.len() - 1;
            for (i, line) in lines.iter().enumerate() {
                input
                    .write_all(line.replace('\r', "\n").as_bytes())
                    .unwrap();
                input.flush().unwrap();
                if i != last {
                    assert!(frame(&mut output).contains("MORE"));
                }
            }
            drop(input);
            let mut result = String::new();
            output.read_to_string(&mut result).unwrap();
            assert!(child.wait().unwrap().success());
            assert!(result.contains("中文 \" quote $() ; \\ *"));
            assert!(result.contains("DSSH_unit_END:0"));
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn selected_asset_payload_roundtrips_through_a_real_interactive_pty() {
        use crate::ssh::interactive_snapshot::TerminalSnapshotState;
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};
        use std::{
            io::{Read, Write},
            sync::{Arc, Mutex},
            thread,
            time::Instant,
        };

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 30,
                cols: 90,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/bash");
        command.args(["--noprofile", "--norc", "-i"]);
        command.env("PS1", "[test@selected-asset ~]# ");
        command.env("PS2", "> ");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let state = Arc::new(Mutex::new(TerminalSnapshotState::default()));
        {
            let mut state = state.lock().unwrap();
            state.output("Welcome to JumpServer\r\n1) selected-asset 10.0.0.2\r\nOpt> ");
            state.observe_input("1\r");
        }
        let visible = Arc::new(Mutex::new(String::new()));
        let trace = Arc::new(Mutex::new(String::new()));
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (read_state, read_visible, read_trace) =
            (state.clone(), visible.clone(), trace.clone());
        let read_thread = thread::spawn(move || {
            let mut bytes = [0; 8192];
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&bytes[..n]);
                        read_trace.lock().unwrap().push_str(&text);
                        let text = read_state.lock().unwrap().output(&text);
                        read_visible.lock().unwrap().push_str(&text);
                    }
                }
            }
        });
        let result = (|| -> Result<(), String> {
            let deadline = Instant::now() + Duration::from_secs(3);
            while !state.lock().unwrap().target("s", "gateway").ready {
                if Instant::now() > deadline {
                    return Err("asset prompt not observed".into());
                }
                thread::sleep(Duration::from_millis(10));
            }
            let original = state.lock().unwrap().target("s", "gateway");
            if original.label != "10.0.0.2" {
                return Err("did not bind selected asset".into());
            }
            let mut receivers = state.lock().unwrap().begin("integration".into());
            writer
                .write_all(preflight("integration").as_bytes())
                .map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
            let deadline = Instant::now() + Duration::from_secs(3);
            let codec = loop {
                if let Ok(codec) = receivers.ready.try_recv() {
                    break codec;
                }
                if Instant::now() > deadline {
                    return Err("preflight not executed by the asset shell".into());
                }
                thread::sleep(Duration::from_millis(10));
            };
            let lines = input_lines(&script("integration"), &codec, "integration");
            let last = lines.len() - 1;
            for (index, line) in lines.into_iter().enumerate() {
                writer
                    .write_all(line.as_bytes())
                    .map_err(|e| e.to_string())?;
                writer.flush().map_err(|e| e.to_string())?;
                if index != last {
                    let deadline = Instant::now() + Duration::from_secs(3);
                    while *receivers.progress.borrow() <= index {
                        if Instant::now() > deadline {
                            return Err("PTY chunk acknowledgement missing".into());
                        }
                        thread::sleep(Duration::from_millis(5));
                    }
                }
            }
            let deadline = Instant::now() + Duration::from_secs(25);
            let output = loop {
                if let Ok(output) = receivers.result.try_recv() {
                    break output.map_err(|e| e.message)?;
                }
                if Instant::now() > deadline {
                    let trace = trace.lock().unwrap();
                    let mut start = trace.len().saturating_sub(500);
                    while !trace.is_char_boundary(start) {
                        start += 1;
                    }
                    return Err(format!(
                        "framed output never completed: ready={}, begin={}, end={}, length={}, tail={:?}",
                        trace.contains("\x1eDSSH_integration_READY"),
                        trace.contains("\x1eDSSH_integration_BEGIN"),
                        trace.contains("\x1eDSSH_integration_END"),
                        trace.len(),
                        &trace[start..]
                    ));
                }
                thread::sleep(Duration::from_millis(10));
            };
            if !output.stdout.contains("@@DSSH:HOST") || !output.stdout.contains("@@DSSH:END") {
                return Err("incomplete PTY payload execution".into());
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            while !state.lock().unwrap().target("s", "gateway").ready {
                if Instant::now() > deadline {
                    return Err("shell not restored".into());
                }
                thread::sleep(Duration::from_millis(10));
            }
            if state.lock().unwrap().target("s", "gateway").identity != original.identity {
                return Err("asset binding changed".into());
            }
            if visible.lock().unwrap().contains("@@DSSH:") {
                return Err("probe output leaked to visible terminal".into());
            }
            Ok(())
        })();
        let _ = writer.write_all(b"\x03");
        thread::sleep(Duration::from_millis(100));
        let _ = child.kill();
        drop(writer);
        drop(pair.master);
        let _ = child.wait();
        read_thread.join().unwrap();
        assert!(result.is_ok(), "{}", result.unwrap_err());
    }
}
