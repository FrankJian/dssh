use super::{Interface, Neighbor, Observation, ProbeContext, normalize_mac};
use crate::error::{AppError, AppResult};
use std::{collections::HashMap, ffi::c_void, net::Ipv4Addr};
use tokio_util::sync::CancellationToken;

type Handle = *mut c_void;
#[repr(C)]
struct IpOptions {
    ttl: u8,
    tos: u8,
    flags: u8,
    size: u8,
    data: *mut u8,
}
#[repr(C)]
struct EchoReply {
    address: u32,
    status: u32,
    round_trip_time: u32,
    data_size: u16,
    reserved: u16,
    data: *mut c_void,
    options: IpOptions,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct AddressRow {
    address: u32,
    index: u32,
    mask: u32,
    broadcast: u32,
    reassembly: u32,
    unused: u16,
    kind: u16,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct NeighborRow {
    index: u32,
    length: u32,
    mac: [u8; 8],
    address: u32,
    kind: u32,
}

#[link(name = "iphlpapi")]
unsafe extern "system" {
    fn GetIpAddrTable(table: *mut c_void, size: *mut u32, order: i32) -> u32;
    fn GetIpNetTable(table: *mut c_void, size: *mut u32, order: i32) -> u32;
    fn GetBestRoute(destination: u32, source: u32, route: *mut u32) -> u32;
    fn IcmpCreateFile() -> Handle;
    fn IcmpCloseHandle(handle: Handle) -> i32;
    fn IcmpSendEcho2Ex(
        handle: Handle,
        event: Handle,
        callback: *mut c_void,
        context: *mut c_void,
        source: u32,
        destination: u32,
        data: *const c_void,
        size: u16,
        options: *const c_void,
        reply: *mut c_void,
        reply_size: u32,
        timeout: u32,
    ) -> u32;
    fn SendARP(destination: u32, source: u32, address: *mut c_void, length: *mut u32) -> u32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetLastError() -> u32;
}

fn native(ip: Ipv4Addr) -> u32 {
    u32::from_ne_bytes(ip.octets())
}
fn address(value: u32) -> Ipv4Addr {
    Ipv4Addr::from(value.to_ne_bytes())
}

fn table<T: Copy>(
    call: unsafe extern "system" fn(*mut c_void, *mut u32, i32) -> u32,
) -> AppResult<Vec<T>> {
    let mut size = 0;
    let initial = unsafe { call(std::ptr::null_mut(), &mut size, 0) };
    if initial == 232 {
        return Ok(Vec::new());
    }
    if initial != 0 && initial != 122 {
        return Err(AppError::new("scan_interfaces", "无法读取系统网络表。"));
    }
    for _ in 0..3 {
        if !(4..=4 * 1024 * 1024).contains(&size) {
            return Err(AppError::new("scan_interfaces", "系统网络表大小无效。"));
        }
        let mut buffer = vec![0_u32; (size as usize).div_ceil(4)];
        let capacity = buffer.len() * 4;
        let status = unsafe { call(buffer.as_mut_ptr().cast(), &mut size, 0) };
        if status == 232 {
            return Ok(Vec::new());
        }
        if status == 122 {
            continue;
        }
        if status != 0 || size as usize > capacity {
            return Err(AppError::new("scan_interfaces", "无法读取系统网络表。"));
        }
        let count = buffer[0] as usize;
        let stride = std::mem::size_of::<T>();
        if count > capacity.saturating_sub(4) / stride {
            return Err(AppError::new("scan_interfaces", "系统网络表数据无效。"));
        }
        let bytes = buffer.as_ptr().cast::<u8>();
        // MIB_IPADDRROW and MIB_IPNETROW are DWORD-aligned, 24-byte rows.
        return Ok((0..count)
            .map(|i| unsafe { bytes.add(4 + i * stride).cast::<T>().read_unaligned() })
            .collect());
    }
    Err(AppError::new(
        "scan_interfaces",
        "网络接口正在变化，请重试。",
    ))
}

pub async fn interfaces() -> AppResult<Vec<Interface>> {
    tokio::task::spawn_blocking(|| {
        let mut interfaces: Vec<_> = table::<AddressRow>(GetIpAddrTable)?
            .into_iter()
            .filter_map(|row| {
                let ip = address(row.address);
                let mask = u32::from(address(row.mask));
                (!ip.is_unspecified() && mask.count_ones() == mask.leading_ones()).then(|| {
                    Interface {
                        name: format!("接口 {}", row.index),
                        address: ip,
                        mask,
                    }
                })
            })
            .collect();
        interfaces.sort_by_key(|i| (i.address.is_loopback(), i.address));
        Ok(interfaces)
    })
    .await
    .map_err(|_| AppError::new("scan_interfaces", "读取网络接口失败。"))?
}

pub async fn neighbors(_cancel: &CancellationToken) -> AppResult<HashMap<Ipv4Addr, Neighbor>> {
    tokio::task::spawn_blocking(|| {
        Ok(table::<NeighborRow>(GetIpNetTable)?
            .into_iter()
            .filter_map(|row| {
                if row.length != 6 || !matches!(row.kind, 3 | 4) {
                    return None;
                }
                let text = row.mac[..6]
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect::<Vec<_>>()
                    .join(":");
                Some((
                    address(row.address),
                    Neighbor {
                        mac: normalize_mac(&text)?,
                        interface: format!("接口 {}", row.index),
                    },
                ))
            })
            .collect())
    })
    .await
    .map_err(|_| AppError::new("scan_neighbors", "读取邻居表失败。"))?
}

struct IcmpHandle(Handle);
impl Drop for IcmpHandle {
    fn drop(&mut self) {
        unsafe { IcmpCloseHandle(self.0) };
    }
}

fn icmp(ip: Ipv4Addr, source: Option<Ipv4Addr>) -> Result<Option<f64>, String> {
    let raw_handle = unsafe { IcmpCreateFile() };
    if raw_handle.is_null() || raw_handle as isize == -1 {
        return Err("系统 ICMP 不可用，请检查权限。".into());
    }
    let handle = IcmpHandle(raw_handle);
    let payload = *b"DuoSSH01";
    let mut reply = vec![0_usize; 128];
    let count = unsafe {
        IcmpSendEcho2Ex(
            handle.0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            source.map(native).unwrap_or(0),
            native(ip),
            payload.as_ptr().cast(),
            payload.len() as u16,
            std::ptr::null(),
            reply.as_mut_ptr().cast(),
            (reply.len() * std::mem::size_of::<usize>()) as u32,
            800,
        )
    };
    if count == 0 {
        let code = unsafe { GetLastError() };
        return if code == 11010 {
            Ok(None)
        } else {
            Err(format!(
                "ICMP 探测失败（系统代码 {code}），请检查路由和权限。"
            ))
        };
    }
    let reply = unsafe { reply.as_ptr().cast::<EchoReply>().read_unaligned() };
    if reply.status == 0 && address(reply.address) == ip {
        return Ok(Some(f64::from(reply.round_trip_time)));
    }
    if reply.status == 11010 {
        return Ok(None);
    }
    Err(format!("目标未确认响应（ICMP 状态 {}）。", reply.status))
}

pub async fn preflight(_cancel: &CancellationToken) -> AppResult<()> {
    let result = tokio::task::spawn_blocking(|| icmp(Ipv4Addr::LOCALHOST, None)).await;
    if !matches!(result, Ok(Ok(Some(_)))) {
        return Err(AppError::new(
            "scan_icmp",
            "本机 ICMP 探测不可用，请检查权限。",
        ));
    }
    Ok(())
}

pub async fn probe(
    ip: Ipv4Addr,
    context: &ProbeContext,
    cancel: &CancellationToken,
) -> Observation {
    let context = context.clone();
    let cancel = cancel.clone();
    tokio::task::spawn_blocking(move || {
        let mut result = Observation::default();
        let mut route = [0_u32; 14];
        if unsafe {
            GetBestRoute(
                native(ip),
                context.source.map(native).unwrap_or(0),
                route.as_mut_ptr(),
            )
        } != 0
        {
            result.error = Some("无法确定目标路由。".into());
            return result;
        }
        let name = format!("接口 {}", route[4]);
        let interface = context
            .interfaces
            .iter()
            .find(|i| i.name == name && context.source.is_none_or(|s| i.address == s));
        if context.source.is_some() && interface.is_none() {
            result.error = Some("所选来源接口与目标路由不一致。".into());
            return result;
        }
        result.source = interface.map(|i| format!("{} · {}", i.name, i.address));
        for _ in 0..2 {
            if cancel.is_cancelled() {
                result.error = Some("扫描已停止。".into());
                return result;
            }
            match icmp(ip, context.source) {
                Ok(Some(ms)) => {
                    result.reply_ms = Some(ms);
                    break;
                }
                Ok(None) => {}
                Err(error) => {
                    result.error = Some(error);
                    break;
                }
            }
        }
        let direct = route[3] == 0 && interface.is_some_and(|i| i.contains(ip));
        if direct && !cancel.is_cancelled() {
            let mut bytes = [0_u32; 2];
            let mut length = 8;
            let status = unsafe {
                SendARP(
                    native(ip),
                    interface.map(|i| native(i.address)).unwrap_or(0),
                    bytes.as_mut_ptr().cast(),
                    &mut length,
                )
            };
            if status == 0 && length == 6 {
                let mac = bytes
                    .iter()
                    .flat_map(|b| b.to_ne_bytes())
                    .take(6)
                    .map(|b| format!("{b:02x}"))
                    .collect::<Vec<_>>()
                    .join(":");
                result.neighbor = normalize_mac(&mac);
                result.fresh_neighbor =
                    result.neighbor.is_some() && !context.neighbors.contains_key(&ip);
                if result.neighbor.is_none() {
                    result.error = Some("系统返回了无效 MAC。".into());
                }
            } else if status != 67 {
                result.error = Some(format!("邻居解析未完成（系统代码 {status}）。"));
            }
        }
        result
    })
    .await
    .unwrap_or_else(|_| Observation {
        error: Some("系统探测任务失败。".into()),
        ..Default::default()
    })
}
