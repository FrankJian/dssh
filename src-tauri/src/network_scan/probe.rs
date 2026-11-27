use std::{
    collections::HashMap,
    net::Ipv4Addr,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    models::network_scan::{AddressStatus, ScanInterface, ScanRow},
};

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "unsupported.rs"]
mod platform;

#[derive(Clone, Debug)]
pub struct Interface {
    pub name: String,
    pub address: Ipv4Addr,
    pub mask: u32,
}
impl Interface {
    pub fn contains(&self, ip: Ipv4Addr) -> bool {
        u32::from(ip) & self.mask == u32::from(self.address) & self.mask
    }
    pub fn public(&self) -> ScanInterface {
        ScanInterface {
            name: self.name.clone(),
            address: self.address.to_string(),
            prefix: self.mask.leading_ones() as u8,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Neighbor {
    pub mac: String,
    pub interface: String,
}

#[derive(Default)]
pub struct Observation {
    pub reply_ms: Option<f64>,
    pub neighbor: Option<String>,
    pub fresh_neighbor: bool,
    pub error: Option<String>,
    pub source: Option<String>,
}

#[derive(Clone)]
pub struct ProbeContext {
    pub interfaces: Vec<Interface>,
    pub neighbors: HashMap<Ipv4Addr, Neighbor>,
    pub source: Option<Ipv4Addr>,
}

pub async fn interfaces() -> AppResult<Vec<ScanInterface>> {
    Ok(platform::interfaces()
        .await?
        .into_iter()
        .filter(|i| !i.address.is_loopback())
        .map(|i| i.public())
        .collect())
}

pub async fn prepare(
    source: Option<String>,
    cancel: &CancellationToken,
) -> AppResult<ProbeContext> {
    let interfaces = platform::interfaces().await?;
    let source = source.map(|s| super::range::parse_ipv4(&s)).transpose()?;
    if source.is_some_and(|ip| !interfaces.iter().any(|i| i.address == ip)) {
        return Err(AppError::new(
            "scan_source",
            "所选来源地址已不可用，请刷新网络接口。",
        ));
    }
    let neighbors = platform::neighbors(cancel).await?;
    platform::preflight(cancel).await?;
    Ok(ProbeContext {
        interfaces,
        neighbors,
        source,
    })
}

pub async fn target(ip: Ipv4Addr, context: &ProbeContext, cancel: &CancellationToken) -> ScanRow {
    if context
        .interfaces
        .iter()
        .any(|interface| interface.address == ip)
    {
        return classify(
            ip,
            Observation {
                reply_ms: Some(0.0),
                source: Some(ip.to_string()),
                ..Default::default()
            },
            "本机接口地址",
        );
    }
    let observation = platform::probe(ip, context, cancel).await;
    classify(ip, observation, "收到目标 ICMP 回复")
}

pub fn classify(ip: Ipv4Addr, observation: Observation, reply_evidence: &str) -> ScanRow {
    let (status, evidence) = if observation.reply_ms.is_some() {
        (AddressStatus::Occupied, reply_evidence.to_owned())
    } else if observation.fresh_neighbor && observation.neighbor.is_some() {
        (
            AddressStatus::Occupied,
            "本次同链路邻居解析获得 MAC（可能包含代理 ARP 代答）".into(),
        )
    } else if let Some(error) = observation.error {
        (AddressStatus::Unknown, error)
    } else if observation.neighbor.is_some() {
        (
            AddressStatus::Unknown,
            "存在邻居缓存，无法确认设备当前在线".into(),
        )
    } else {
        (
            AddressStatus::Unresponsive,
            "两次 ICMP 探测未响应，未发现有效目标邻居映射".into(),
        )
    };
    let mut row = ScanRow::new(ip, status, &evidence);
    row.mac = observation.neighbor;
    row.response_ms = observation.reply_ms;
    row.source = observation.source;
    row.checked_at = Some(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    );
    row
}

pub fn normalize_mac(text: &str) -> Option<String> {
    let values: Vec<_> = text.split([':', '-']).collect();
    if values.len() != 6 || values.iter().any(|v| v.is_empty() || v.len() > 2) {
        return None;
    }
    let bytes: Vec<u8> = values
        .iter()
        .map(|s| u8::from_str_radix(s, 16))
        .collect::<Result<_, _>>()
        .ok()?;
    if bytes.iter().all(|b| *b == 0) || bytes[0] & 1 != 0 {
        return None;
    }
    Some(
        bytes
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn evidence_precedence_never_turns_errors_or_cache_green() {
        let ip = Ipv4Addr::new(192, 168, 1, 10);
        assert_eq!(
            classify(ip, Observation::default(), "").status,
            AddressStatus::Unresponsive
        );
        assert_eq!(
            classify(
                ip,
                Observation {
                    error: Some("无路由".into()),
                    ..Default::default()
                },
                ""
            )
            .status,
            AddressStatus::Unknown
        );
        assert_eq!(
            classify(
                ip,
                Observation {
                    neighbor: Some("02:00:00:00:00:01".into()),
                    ..Default::default()
                },
                ""
            )
            .status,
            AddressStatus::Unknown
        );
        assert_eq!(
            classify(
                ip,
                Observation {
                    neighbor: Some("02:00:00:00:00:01".into()),
                    fresh_neighbor: true,
                    ..Default::default()
                },
                ""
            )
            .status,
            AddressStatus::Occupied
        );
        assert_eq!(
            classify(
                ip,
                Observation {
                    reply_ms: Some(1.0),
                    error: Some("ARP unavailable".into()),
                    ..Default::default()
                },
                "ICMP"
            )
            .status,
            AddressStatus::Occupied
        );
    }
    #[test]
    fn mac_and_subnet_validation() {
        assert_eq!(
            normalize_mac("2:0:0:0:0:1").as_deref(),
            Some("02:00:00:00:00:01")
        );
        for text in [
            "ff:ff:ff:ff:ff:ff",
            "00:00:00:00:00:00",
            "01:00:5e:00:00:01",
            "(incomplete)",
            "1:2:3",
        ] {
            assert!(normalize_mac(text).is_none());
        }
        let interface = Interface {
            name: "en0".into(),
            address: "192.168.1.2".parse().unwrap(),
            mask: 0xffffff00,
        };
        assert!(interface.contains("192.168.1.3".parse().unwrap()));
        assert!(!interface.contains("192.168.2.3".parse().unwrap()));
    }
}
