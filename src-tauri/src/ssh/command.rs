use std::{sync::Arc, time::Duration};

use russh::{ChannelMsg, Disconnect, client};
use serde::Serialize;

use crate::{
    error::AppResult,
    models::ssh_profile::SshProfile,
    ssh::host_keys::HostKeyVerifier,
    ssh::session_manager::{SshClient, authenticate, ssh_error},
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

/// Open a fresh SSH connection, run a single command on an exec channel, and
/// collect its stdout/stderr and exit status. This is used by the AI agent to
/// perform one-shot server operations without attaching an interactive shell.
pub async fn run_ssh_command(
    profile: SshProfile,
    command: String,
    timeout_secs: u64,
    verifier: Arc<HostKeyVerifier>,
) -> AppResult<CommandOutput> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60 * 60)),
        ..<_>::default()
    });
    let address = (profile.host.as_str(), profile.port);
    let client = SshClient::new(verifier, profile.host.clone(), profile.port);
    let mut handle = client::connect(config, address, client)
        .await
        .map_err(ssh_error)?;

    authenticate(&mut handle, &profile).await?;

    let mut channel = handle.channel_open_session().await.map_err(ssh_error)?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(ssh_error)?;

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut exit_code: Option<u32> = None;

    let read_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
                Some(ChannelMsg::ExtendedData { data, .. }) => stderr.extend_from_slice(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                // The server sends EOF *before* the exit-status request, so keep
                // reading after EOF; only stop once the channel actually closes.
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
    };

    let timed_out = tokio::time::timeout(Duration::from_secs(timeout_secs.max(1)), read_loop)
        .await
        .is_err();

    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        exit_code,
        timed_out,
    })
}
