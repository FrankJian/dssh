use crate::models::terminal::TerminalSize;

pub mod command;
pub mod connection_pool;
pub mod host_keys;
pub mod session_manager;

pub use command::{CommandOutput, run_ssh_command};
pub use connection_pool::{
    ChannelLease, ChannelOwner, ConnectionKey, ConnectionLease, SSH_TRANSPORT_STATUS_EVENT,
    SshConnectionDiagnostics, SshConnectionPool, SshTransportStatusEvent,
    transport_recovering_error,
};
pub use host_keys::HostKeyVerifier;
pub use session_manager::SessionManager;

#[derive(Debug, Clone)]
pub struct SshSessionOptions {
    pub profile_id: String,
    pub initial_size: TerminalSize,
}
