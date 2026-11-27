use super::{Interface, Neighbor, Observation, ProbeContext, normalize_mac};
use crate::error::{AppError, AppResult};
use std::{
    collections::HashMap,
    ffi::CStr,
    net::Ipv4Addr,
    process::{Output, Stdio},
    time::Duration,
};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

pub async fn command(path: &str, args: &[String], cancel: &CancellationToken) -> AppResult<Output> {
    let mut process = Command::new(path);
    process
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = process
        .spawn()
        .map_err(|_| AppError::new("scan_process", "无法启动系统网络工具。"))?;
    tokio::select! {
        _ = cancel.cancelled() => Err(AppError::new("scan_cancelled", "扫描已停止。")),
        result = tokio::time::timeout(Duration::from_secs(4), child.wait_with_output()) => {
            result.map_err(|_| AppError::new("scan_timeout", "系统网络工具执行超时。"))?
                .map_err(|_| AppError::new("scan_process", "无法读取系统网络工具结果。"))
        }
    }
}

pub async fn interfaces() -> AppResult<Vec<Interface>> {
    let mut head = std::ptr::null_mut();
    // getifaddrs owns the returned linked list until freeifaddrs below.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return Err(AppError::new("scan_interfaces", "无法读取本机网络接口。"));
    }
    let mut result = Vec::new();
    let mut cursor = head;
    while !cursor.is_null() {
        let entry = unsafe { &*cursor };
        if !entry.ifa_addr.is_null()
            && !entry.ifa_netmask.is_null()
            && entry.ifa_flags & libc::IFF_UP as u32 != 0
            && unsafe { (*entry.ifa_addr).sa_family as i32 } == libc::AF_INET
        {
            let address = unsafe { &*entry.ifa_addr.cast::<libc::sockaddr_in>() };
            let netmask = unsafe { &*entry.ifa_netmask.cast::<libc::sockaddr_in>() };
            let ip = Ipv4Addr::from(address.sin_addr.s_addr.to_ne_bytes());
            let mask = u32::from_be_bytes(netmask.sin_addr.s_addr.to_ne_bytes());
            if mask.leading_ones() == mask.count_ones() && !ip.is_unspecified() {
                result.push(Interface {
                    name: unsafe { CStr::from_ptr(entry.ifa_name) }
                        .to_string_lossy()
                        .into_owned(),
                    address: ip,
                    mask,
                });
            }
        }
        cursor = entry.ifa_next;
    }
    unsafe { libc::freeifaddrs(head) };
    result.sort_by_key(|i| (i.address.is_loopback(), i.name.clone(), i.address));
    Ok(result)
}

pub fn parse_neighbors(output: &str) -> HashMap<Ipv4Addr, Neighbor> {
    let mut neighbors = HashMap::new();
    for line in output.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        let Some(at) = fields.iter().position(|s| *s == "at") else {
            continue;
        };
        let Some(on) = fields.iter().position(|s| *s == "on") else {
            continue;
        };
        let ip = at
            .checked_sub(1)
            .and_then(|n| fields.get(n))
            .and_then(|s| s.trim_matches(['(', ')']).parse().ok());
        if let (Some(ip), Some(mac), Some(interface)) = (
            ip,
            fields.get(at + 1).and_then(|s| normalize_mac(s)),
            fields.get(on + 1),
        ) {
            neighbors.insert(
                ip,
                Neighbor {
                    mac,
                    interface: (*interface).to_owned(),
                },
            );
        }
    }
    neighbors
}

pub async fn neighbors(cancel: &CancellationToken) -> AppResult<HashMap<Ipv4Addr, Neighbor>> {
    let output = command("/usr/sbin/arp", &["-an".into()], cancel).await?;
    if !output.status.success() {
        return Err(AppError::new(
            "scan_neighbors",
            "无法读取邻居表，请检查本机网络权限。",
        ));
    }
    Ok(parse_neighbors(&String::from_utf8_lossy(&output.stdout)))
}

fn ping_args(ip: Ipv4Addr, source: Option<Ipv4Addr>) -> Vec<String> {
    let mut args = vec![
        "-n".into(),
        "-c".into(),
        "2".into(),
        "-W".into(),
        "800".into(),
        "-t".into(),
        "3".into(),
    ];
    if let Some(source) = source {
        args.extend(["-S".into(), source.to_string()]);
    }
    args.push(ip.to_string());
    args
}

fn ping_result(output: &Output, ip: Ipv4Addr) -> Result<Option<f64>, String> {
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if line.contains(&format!("bytes from {ip}:"))
            && line.contains("icmp_seq=")
            && line.contains("ttl=")
        {
            let time = line
                .split("time=")
                .nth(1)
                .or_else(|| line.split("time<").nth(1))
                .and_then(|s| s.split_whitespace().next())
                .and_then(|s| s.parse::<f64>().ok());
            return Ok(Some(time.unwrap_or(0.0)));
        }
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() || text.to_lowercase().contains("unreachable") {
        return Err("ICMP 探测失败，可能是权限、接口或路由不可达。".into());
    }
    if text.contains("0 packets received") {
        return Ok(None);
    }
    Err("系统 ICMP 输出无法确认，请检查网络权限。".into())
}

pub async fn preflight(cancel: &CancellationToken) -> AppResult<()> {
    let ip = Ipv4Addr::LOCALHOST;
    let output = command(
        "/sbin/ping",
        &[
            "-n".into(),
            "-c".into(),
            "1".into(),
            "-W".into(),
            "800".into(),
            "-t".into(),
            "2".into(),
            ip.to_string(),
        ],
        cancel,
    )
    .await?;
    if !matches!(ping_result(&output, ip), Ok(Some(_))) {
        return Err(AppError::new(
            "scan_icmp",
            "本机 ICMP 探测不可用，请检查网络权限。",
        ));
    }
    Ok(())
}

pub async fn probe(
    ip: Ipv4Addr,
    context: &ProbeContext,
    cancel: &CancellationToken,
) -> Observation {
    let mut result = Observation::default();
    let route = match command(
        "/sbin/route",
        &["-n".into(), "get".into(), ip.to_string()],
        cancel,
    )
    .await
    {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => {
            result.error = Some("无法确定目标路由，未确认地址状态。".into());
            return result;
        }
    };
    let interface_name = route
        .lines()
        .find_map(|line| line.trim().strip_prefix("interface:").map(str::trim));
    let interface = context
        .interfaces
        .iter()
        .filter(|i| {
            Some(i.name.as_str()) == interface_name && context.source.is_none_or(|s| s == i.address)
        })
        .max_by_key(|i| (i.contains(ip), i.mask.leading_ones()));
    if context.source.is_some() && interface.is_none() {
        result.error = Some("所选来源接口与目标路由不一致，请切换来源接口。".into());
        return result;
    }
    result.source = interface.map(|i| format!("{} · {}", i.name, i.address));
    match command("/sbin/ping", &ping_args(ip, context.source), cancel).await {
        Ok(output) => match ping_result(&output, ip) {
            Ok(reply) => result.reply_ms = reply,
            Err(error) => result.error = Some(error),
        },
        Err(error) => result.error = Some(error.message),
    }
    let direct = interface.is_some_and(|i| i.contains(ip))
        && !route
            .lines()
            .any(|l| l.trim().starts_with("flags:") && l.contains("GATEWAY"));
    if direct && !cancel.is_cancelled() {
        match command("/usr/sbin/arp", &["-n".into(), ip.to_string()], cancel).await {
            Ok(output) => {
                let records = parse_neighbors(&String::from_utf8_lossy(&output.stdout));
                if let Some(neighbor) = records
                    .get(&ip)
                    .filter(|n| Some(n.interface.as_str()) == interface_name)
                {
                    result.neighbor = Some(neighbor.mac.clone());
                    result.fresh_neighbor = !context.neighbors.contains_key(&ip);
                } else if !output.status.success()
                    && !String::from_utf8_lossy(&output.stdout).contains("no entry")
                {
                    result.error = Some("无法读取目标邻居信息。".into());
                }
            }
            Err(error) => result.error = Some(error.message),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    #[tokio::test]
    #[ignore = "Runs the system ping against localhost"]
    async fn native_icmp_reply() {
        let cancel = CancellationToken::new();
        let ip = Ipv4Addr::LOCALHOST;
        let output = command("/sbin/ping", &ping_args(ip, None), &cancel)
            .await
            .unwrap();
        assert!(matches!(ping_result(&output, ip), Ok(Some(_))));
    }
    #[tokio::test]
    async fn cancellation_interrupts_system_process() {
        let cancel = CancellationToken::new();
        let args = ["10".into()];
        let task = command("/bin/sleep", &args, &cancel);
        let stop = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            cancel.cancel();
        };
        let (result, _) = tokio::join!(task, stop);
        assert_eq!(result.unwrap_err().code, "scan_cancelled");
    }
    #[test]
    fn parses_complete_target_neighbors_only() {
        let records = parse_neighbors(
            "? (192.168.1.1) at 2:0:0:0:0:1 on en0 ifscope [ethernet]\n? (192.168.1.2) at (incomplete) on en0 ifscope [ethernet]",
        );
        assert_eq!(records.len(), 1);
        assert_eq!(
            records[&"192.168.1.1".parse::<Ipv4Addr>().unwrap()].interface,
            "en0"
        );
    }
    #[test]
    fn unreachable_is_not_a_reply_and_args_are_separate() {
        let ip: Ipv4Addr = "192.168.1.10".parse().unwrap();
        let output = |text: &str| Output {
            status: std::process::ExitStatus::from_raw(0),
            stdout: text.as_bytes().to_vec(),
            stderr: vec![],
        };
        assert!(
            ping_result(
                &output("From 192.168.1.1: Destination Host Unreachable"),
                ip
            )
            .is_err()
        );
        assert_eq!(
            ping_result(
                &output("64 bytes from 192.168.1.10: icmp_seq=0 ttl=64 time=1.25 ms"),
                ip
            ),
            Ok(Some(1.25))
        );
        assert_eq!(ping_args(ip, None).last().unwrap(), "192.168.1.10");
    }
}
