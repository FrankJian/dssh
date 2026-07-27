use crate::models::terminal::TerminalSize;

pub mod command;
pub mod host_keys;
pub mod session_manager;

pub use command::{CommandOutput, run_ssh_command};
pub use host_keys::HostKeyVerifier;
pub use session_manager::SessionManager;

#[derive(Debug, Clone)]
pub struct SshSessionOptions {
    pub profile_id: String,
    pub initial_size: TerminalSize,
}
