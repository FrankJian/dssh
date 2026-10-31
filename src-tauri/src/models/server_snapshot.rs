use serde::Serialize;

use crate::ssh::CommandOutput;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSnapshotTarget {
    pub source: &'static str,
    pub identity: String,
    pub label: String,
    pub ready: bool,
    pub reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSnapshotResult {
    #[serde(flatten)]
    pub output: CommandOutput,
    pub target: ServerSnapshotTarget,
}
