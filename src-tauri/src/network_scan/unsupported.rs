use super::{Interface, Neighbor, Observation, ProbeContext};
use crate::error::{AppError, AppResult};
use std::{collections::HashMap, net::Ipv4Addr};
use tokio_util::sync::CancellationToken;
fn unsupported() -> AppError {
    AppError::new("scan_platform", "IP 地址检测目前支持 macOS 和 Windows。")
}
pub async fn interfaces() -> AppResult<Vec<Interface>> {
    Err(unsupported())
}
pub async fn neighbors(_: &CancellationToken) -> AppResult<HashMap<Ipv4Addr, Neighbor>> {
    Err(unsupported())
}
pub async fn preflight(_: &CancellationToken) -> AppResult<()> {
    Err(unsupported())
}
pub async fn probe(_: Ipv4Addr, _: &ProbeContext, _: &CancellationToken) -> Observation {
    Observation {
        error: Some(unsupported().message),
        ..Default::default()
    }
}
