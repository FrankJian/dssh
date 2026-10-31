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

/// Run an SSH exec command with a hard combined stdout/stderr byte cap, so a
/// faulty remote process cannot grow the desktop process without bound.
pub(crate) async fn run_ssh_command_with_limit(
    profile: SshProfile,
    command: String,
    timeout_secs: u64,
    max_output_bytes: usize,
    pool: &SshConnectionPool,
) -> AppResult<CommandOutput> {
    let transport = pool.acquire(profile, ChannelOwner::Exec).await?;
    let (mut channel, _channel_lease) = transport.open_session_channel().await?;
    if channel.exec(true, command.as_bytes()).await.is_err() {
        if transport.is_closed().await {
            transport.invalidate().await;
            return Err(transport_recovering_error());
        }
        return Err(AppError::new("ssh_exec_failed", "无法发送 SSH 命令。"));
    }

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit_code: Option<u32> = None;
    let mut channel_closed = false;
    let mut output_truncated = false;
    let mut exec_rejected = false;

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
                Some(ChannelMsg::Failure) => {
                    exec_rejected = true;
                    break;
                }
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
    if timed_out || output_truncated || exec_rejected {
        let _ = channel.close().await;
    }
    // A policy rejection (common on gateways) is channel-local. Never tear
    // down live PTYs/SFTP just because the server does not permit exec.
    if exec_rejected {
        return Err(AppError::new(
            "ssh_exec_rejected",
            "服务器拒绝 SSH exec 命令（网关可能仅允许交互终端）。",
        ));
    }
    if !timed_out && channel_closed && exit_code.is_none() {
        if transport.is_closed().await {
            transport.invalidate().await;
            return Err(transport_recovering_error());
        }
        return Err(AppError::new(
            "ssh_exec_closed",
            "SSH exec 通道提前关闭，未返回退出状态。",
        ));
    }

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        exit_code,
        timed_out,
        output_truncated,
    })
}
