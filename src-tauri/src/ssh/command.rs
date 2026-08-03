use std::time::Duration;

use russh::ChannelMsg;
use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::SshProfile,
    ssh::{ChannelOwner, SshConnectionPool, transport_recovering_error},
};

/// Result of running a single command over SSH (non-interactive exec channel).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<u32>,
    pub timed_out: bool,
    pub output_truncated: bool,
}

/// Run one command on an independent exec channel over a shared SSH transport.
/// The lease and channel permit last only for this command, so a command error
/// or timeout cannot disconnect other channels on the same transport.
pub async fn run_ssh_command(
    profile: SshProfile,
    command: String,
    timeout_secs: u64,
    pool: &SshConnectionPool,
) -> AppResult<CommandOutput> {
    run_ssh_command_with_limit(profile, command, timeout_secs, usize::MAX, pool).await
}

/// Run an SSH exec command with a hard combined stdout/stderr byte cap.
/// Kubernetes discovery and watch commands use this to keep a faulty remote
/// process from growing the desktop process without bound.
pub async fn run_ssh_command_with_limit(
    profile: SshProfile,
    command: String,
    timeout_secs: u64,
    max_output_bytes: usize,
    pool: &SshConnectionPool,
) -> AppResult<CommandOutput> {
    let transport = pool.acquire(profile, ChannelOwner::Exec).await?;
    let (mut channel, _channel_lease) = transport.open_session_channel().await?;
    if channel.exec(true, command.as_bytes()).await.is_err() {
        transport.invalidate().await;
        return Err(transport_recovering_error());
    }

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit_code: Option<u32> = None;
    let mut channel_closed = false;
    let mut output_truncated = false;

    let read_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    let remaining = max_output_bytes.saturating_sub(stdout.len() + stderr.len());
                    if data.len() > remaining {
                        stdout.extend_from_slice(&data[..remaining]);
                        output_truncated = true;
                        break;
                    }
                    stdout.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let remaining = max_output_bytes.saturating_sub(stdout.len() + stderr.len());
                    if data.len() > remaining {
                        stderr.extend_from_slice(&data[..remaining]);
                        output_truncated = true;
                        break;
                    }
                    stderr.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                // The server sends EOF *before* the exit-status request, so keep
                // reading after EOF; only stop once the channel actually closes.
                Some(ChannelMsg::Close) | None => {
                    channel_closed = true;
                    break;
                }
                _ => {}
            }
        }
    };

    let timed_out = tokio::time::timeout(Duration::from_secs(timeout_secs.max(1)), read_loop)
        .await
        .is_err();
    if timed_out || output_truncated {
        let _ = channel.close().await;
    }
    if !timed_out && channel_closed && exit_code.is_none() {
        transport.invalidate().await;
        return Err(transport_recovering_error());
    }

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        exit_code,
        timed_out,
        output_truncated,
    })
}

/// Run a bounded command while streaming a structured payload to stdin. The
/// payload is written on the command's private channel and never interpolated
/// into the shell command, which is required for Kubernetes apply/dry-run.
pub async fn run_ssh_command_with_input(
    profile: SshProfile,
    command: String,
    input: &[u8],
    timeout_secs: u64,
    max_output_bytes: usize,
    pool: &SshConnectionPool,
) -> AppResult<CommandOutput> {
    let transport = pool.acquire(profile, ChannelOwner::Exec).await?;
    let (mut channel, _channel_lease) = transport.open_session_channel().await?;
    if channel.exec(true, command.as_bytes()).await.is_err() {
        transport.invalidate().await;
        return Err(transport_recovering_error());
    }
    if channel.data_bytes(input.to_vec()).await.is_err() || channel.eof().await.is_err() {
        let _ = channel.close().await;
        return Err(AppError::new(
            "ssh_command_input_failed",
            "无法向远端命令发送输入。",
        ));
    }

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit_code: Option<u32> = None;
    let mut channel_closed = false;
    let mut output_truncated = false;
    let read_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    let remaining = max_output_bytes.saturating_sub(stdout.len() + stderr.len());
                    if data.len() > remaining {
                        stdout.extend_from_slice(&data[..remaining]);
                        output_truncated = true;
                        break;
                    }
                    stdout.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let remaining = max_output_bytes.saturating_sub(stdout.len() + stderr.len());
                    if data.len() > remaining {
                        stderr.extend_from_slice(&data[..remaining]);
                        output_truncated = true;
                        break;
                    }
                    stderr.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                Some(ChannelMsg::Close) | None => {
                    channel_closed = true;
                    break;
                }
                _ => {}
            }
        }
    };
    let timed_out = tokio::time::timeout(Duration::from_secs(timeout_secs.max(1)), read_loop)
        .await
        .is_err();
    if timed_out || output_truncated {
        let _ = channel.close().await;
    }
    if !timed_out && channel_closed && exit_code.is_none() {
        transport.invalidate().await;
        return Err(transport_recovering_error());
    }
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        exit_code,
        timed_out,
        output_truncated,
    })
}
