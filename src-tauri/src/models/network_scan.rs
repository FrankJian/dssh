use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanRequest {
    pub scan_id: String,
    pub cidr: Option<String>,
    pub start_ip: Option<String>,
    pub end_ip: Option<String>,
    pub source_address: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AddressStatus {
    Pending,
    Scanning,
    Occupied,
    Unresponsive,
    Unknown,
    Reserved,
    Unfinished,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRow {
    pub ip: String,
    pub status: AddressStatus,
    pub evidence: String,
    pub mac: Option<String>,
    pub response_ms: Option<f64>,
    pub checked_at: Option<u64>,
    pub source: Option<String>,
}

impl ScanRow {
    pub fn new(ip: std::net::Ipv4Addr, status: AddressStatus, evidence: &str) -> Self {
        Self {
            ip: ip.to_string(),
            status,
            evidence: evidence.to_owned(),
            mac: None,
            response_ms: None,
            checked_at: None,
            source: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanInterface {
    pub name: String,
    pub address: String,
    pub prefix: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScanPhase {
    Running,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanUpdate {
    pub scan_id: String,
    pub sequence: u32,
    pub range: String,
    pub phase: ScanPhase,
    pub completed: usize,
    pub total: usize,
    pub rows: Vec<ScanRow>,
}
