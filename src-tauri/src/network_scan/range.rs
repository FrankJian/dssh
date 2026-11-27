use std::net::Ipv4Addr;

use crate::{
    error::{AppError, AppResult},
    models::network_scan::{AddressStatus, ScanRequest, ScanRow},
};

pub const MAX_ADDRESSES: u64 = 4096;

pub struct ScanRange {
    pub label: String,
    pub rows: Vec<ScanRow>,
}

pub fn parse_ipv4(value: &str) -> AppResult<Ipv4Addr> {
    value.trim().parse().map_err(|_| {
        AppError::new(
            "scan_address",
            "请输入有效的 IPv4 地址，例如 192.168.1.10。",
        )
    })
}

pub fn unicast(ip: Ipv4Addr) -> bool {
    ip.octets()[0] != 0 && !ip.is_multicast() && ip != Ipv4Addr::BROADCAST && ip.octets()[0] < 240
}

pub fn parse(request: &ScanRequest) -> AppResult<ScanRange> {
    let (start, end, reserved, label) = if let Some(cidr) = &request.cidr {
        if request.start_ip.is_some() || request.end_ip.is_some() {
            return Err(AppError::new("scan_range", "请选择一种地址输入方式。"));
        }
        let (address, prefix) = cidr.trim().split_once('/').ok_or_else(|| {
            AppError::new("scan_cidr", "请输入 IPv4 CIDR 网段，例如 192.168.1.0/24。")
        })?;
        let ip = u32::from(parse_ipv4(address)?);
        let prefix: u32 = prefix
            .parse()
            .ok()
            .filter(|n| *n <= 32)
            .ok_or_else(|| AppError::new("scan_prefix", "IPv4 前缀长度须为 0–32。"))?;
        let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
        let start = ip & mask;
        let end = start | !mask;
        (
            start,
            end,
            prefix < 31,
            format!("{}/{}", Ipv4Addr::from(start), prefix),
        )
    } else {
        let start = parse_ipv4(request.start_ip.as_deref().unwrap_or(""))?;
        let end = parse_ipv4(request.end_ip.as_deref().unwrap_or(""))?;
        (
            u32::from(start),
            u32::from(end),
            false,
            format!("{start} – {end}"),
        )
    };
    if end < start || u64::from(end) - u64::from(start) + 1 > MAX_ADDRESSES {
        return Err(AppError::new(
            "scan_size",
            "起始地址须不大于结束地址，每次最多扫描 4096 个地址。",
        ));
    }
    let mut rows = Vec::with_capacity((end - start + 1) as usize);
    for number in start..=end {
        let ip = Ipv4Addr::from(number);
        let is_reserved = reserved && (number == start || number == end);
        if !is_reserved && !unicast(ip) {
            return Err(AppError::new(
                "scan_unicast",
                "扫描范围须为 IPv4 单播地址，不能包含未指定、多播或保留地址。",
            ));
        }
        let (status, evidence) = if is_reserved {
            (AddressStatus::Reserved, "网络地址或广播地址")
        } else {
            (AddressStatus::Pending, "等待探测")
        };
        rows.push(ScanRow::new(ip, status, evidence));
    }
    Ok(ScanRange { label, rows })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cidr(value: &str) -> ScanRequest {
        ScanRequest {
            scan_id: "test".into(),
            cidr: Some(value.into()),
            start_ip: None,
            end_ip: None,
            source_address: None,
        }
    }

    #[test]
    fn normalizes_cidr_and_preserves_special_prefixes() {
        let subnet = parse(&cidr("192.168.1.42/24")).unwrap();
        assert_eq!(subnet.label, "192.168.1.0/24");
        assert_eq!(subnet.rows.len(), 256);
        assert_eq!(subnet.rows[0].status, AddressStatus::Reserved);
        assert_eq!(subnet.rows[255].status, AddressStatus::Reserved);
        for (value, count) in [("192.168.1.0/31", 2), ("192.168.1.10/32", 1)] {
            let result = parse(&cidr(value)).unwrap();
            assert_eq!(result.rows.len(), count);
            assert!(
                result
                    .rows
                    .iter()
                    .all(|r| r.status == AddressStatus::Pending)
            );
        }
    }

    #[test]
    fn validates_bounds_before_allocating() {
        for value in [
            "0.0.0.0/0",
            "10.0.0.0/19",
            "224.0.0.1/32",
            "0.0.0.0/32",
            "255.255.255.255/32",
            "1.2.3.999/24",
            "1.2.3.4/33",
            "1.2.3.4/x",
        ] {
            assert!(parse(&cidr(value)).is_err(), "{value}");
        }
        assert_eq!(parse(&cidr("10.0.0.0/20")).unwrap().rows.len(), 4096);
        let mut request = cidr("unused");
        request.cidr = None;
        request.start_ip = Some("192.168.0.255".into());
        request.end_ip = Some("192.168.1.1".into());
        let result = parse(&request).unwrap();
        assert_eq!(result.rows.len(), 3);
        assert!(
            result
                .rows
                .iter()
                .all(|r| r.status == AddressStatus::Pending)
        );
        request.end_ip = Some("192.168.0.1".into());
        assert!(parse(&request).is_err());
    }
}
