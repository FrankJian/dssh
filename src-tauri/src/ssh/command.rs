use std::time::Duration;

use russh::ChannelMsg;
use serde::Serialize;

use crate::{
    error::AppResult,
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

    let read_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                Some(ChannelMsg::ExtendedData { data, .. }) => stderr.extend_from_slice(&data),
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
    if timed_out {
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
    })
}
