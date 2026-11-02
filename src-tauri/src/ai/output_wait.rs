//! Wait for changed output to settle briefly, rather than sleeping the full timeout.
//! Settled output is an observation, never proof that a remote command succeeded.
use std::time::Duration;

use tokio::{sync::Notify, time::Instant};

use crate::error::AppResult;

const OUTPUT_QUIET: Duration = Duration::from_millis(120);

pub async fn wait_for_output(
    signal: &Notify,
    baseline: &str,
    max_wait: Duration,
    input_echo: Option<&str>,
    mut read: impl FnMut() -> AppResult<String>,
) -> AppResult<String> {
    let deadline = Instant::now() + max_wait;
    let mut previous = baseline.to_string();
    let mut quiet_until = None;
    loop {
        // Subscribe before checking the buffer: output arriving between the
        // check and await must not turn into a lost wakeup / full-timeout wait.
        let notified = signal.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let current = read()?;
        let now = Instant::now();
        if current != previous {
            // A PTY commonly echoes the submitted command immediately, then
            // starts producing actual output later. Echo alone must not cause
            // an extra model request while the remote operation is starting.
            let echo_only = input_echo.is_some_and(|input| {
                let delta = current.strip_prefix(baseline).unwrap_or(&current);
                let clean = super::tools::strip_ansi(delta);
                clean.trim().is_empty() || clean.trim() == input.trim()
            });
            quiet_until = (!echo_only).then_some(now + OUTPUT_QUIET);
            previous = current;
        }
        let wake_at = quiet_until.unwrap_or(deadline).min(deadline);
        if now >= wake_at {
            return Ok(previous);
        }
        tokio::select! {
            _ = &mut notified => {},
            _ = tokio::time::sleep_until(wake_at) => {},
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn ready_output_returns_early_even_with_a_long_timeout() {
        let output = tokio::time::timeout(
            Duration::from_secs(1),
            wait_for_output(
                &Notify::new(),
                "before",
                Duration::from_secs(10),
                None,
                || Ok("after\nOpt> ".into()),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(output, "after\nOpt> ");
    }

    #[tokio::test]
    async fn waits_for_last_chunk_in_a_burst_without_polling() {
        let signal = Arc::new(Notify::new());
        let output = Arc::new(Mutex::new(String::from("before")));
        let producer = {
            let signal = signal.clone();
            let output = output.clone();
            tokio::spawn(async move {
                for part in ["one", "two", "Opt> "] {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                    output.lock().unwrap().push_str(part);
                    signal.notify_waiters();
                }
            })
        };
        let mut reads = 0;
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            wait_for_output(&signal, "before", Duration::from_secs(10), None, || {
                reads += 1;
                Ok(output.lock().unwrap().clone())
            }),
        )
        .await
        .unwrap()
        .unwrap();
        producer.await.unwrap();
        assert_eq!(result, "beforeonetwoOpt> ");
        assert!(
            reads <= 6,
            "must wake on updates, not poll the full scrollback"
        );
    }

    #[tokio::test]
    async fn silent_terminal_has_a_bounded_deadline() {
        let mut reads = 0;
        let result = wait_for_output(
            &Notify::new(),
            "unchanged",
            Duration::from_millis(25),
            None,
            || {
                reads += 1;
                Ok("unchanged".into())
            },
        )
        .await
        .unwrap();
        assert_eq!(result, "unchanged");
        assert_eq!(reads, 2);
    }

    #[tokio::test]
    async fn notification_during_buffer_read_is_not_lost() {
        let signal = Notify::new();
        let mut reads = 0;
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            wait_for_output(&signal, "before", Duration::from_secs(10), None, || {
                reads += 1;
                if reads == 1 {
                    signal.notify_waiters();
                    Ok("before".into())
                } else {
                    Ok("after".into())
                }
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result, "after");
    }

    #[tokio::test]
    async fn closed_terminal_fails_without_waiting_for_the_deadline() {
        let result = wait_for_output(
            &Notify::new(),
            "before",
            Duration::from_secs(10),
            None,
            || {
                Err(crate::error::AppError::new(
                    "session_not_found",
                    "终端已关闭",
                ))
            },
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn echo_only_waits_for_actual_output_or_the_deadline() {
        let signal = Arc::new(Notify::new());
        let output = Arc::new(Mutex::new("Opt> \u{1b}[?2004l10.0.0.1\r\n".to_string()));
        let producer = {
            let signal = signal.clone();
            let output = output.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(180)).await;
                output
                    .lock()
                    .unwrap()
                    .push_str("1 target 10.0.0.1\r\nOpt> ");
                signal.notify_waiters();
            })
        };
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            wait_for_output(
                &signal,
                "Opt> ",
                Duration::from_secs(10),
                Some("10.0.0.1"),
                || Ok(output.lock().unwrap().clone()),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        producer.await.unwrap();
        assert!(
            result.contains("1 target"),
            "echo alone must not return before the actual result arrives"
        );
    }
}
