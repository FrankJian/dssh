use crate::{
    error::{AppError, AppResult},
    models::network_scan::{AddressStatus, ScanPhase, ScanRequest, ScanRow, ScanUpdate},
};
use futures::{StreamExt, stream::FuturesUnordered};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    future::Future,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

pub mod probe;
pub mod range;

const CONCURRENCY: usize = 32;
#[derive(Default)]
struct Registry {
    jobs: HashMap<String, (String, CancellationToken)>,
    closed: HashSet<String>,
}
#[derive(Clone, Default)]
pub struct ScanManager(Arc<Mutex<Registry>>);
struct Lease {
    manager: ScanManager,
    owner: String,
    id: String,
    token: CancellationToken,
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.token.cancel();
        if let Ok(mut registry) = self.manager.0.lock()
            && registry
                .jobs
                .get(&self.owner)
                .is_some_and(|(id, _)| *id == self.id)
        {
            registry.jobs.remove(&self.owner);
        }
    }
}
impl ScanManager {
    fn register(&self, owner: &str, id: &str) -> AppResult<Lease> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(AppError::new("scan_id", "扫描任务标识无效。"));
        }
        let mut registry = self
            .0
            .lock()
            .map_err(|_| AppError::new("scan_state", "无法读取扫描状态。"))?;
        if registry.closed.contains(owner) {
            return Err(AppError::new("scan_closed", "扫描窗口已关闭。"));
        }
        if registry.jobs.contains_key(owner) {
            return Err(AppError::new(
                "scan_busy",
                "当前窗口已有扫描任务，请等待停止完成。",
            ));
        }
        let token = CancellationToken::new();
        registry
            .jobs
            .insert(owner.to_owned(), (id.to_owned(), token.clone()));
        Ok(Lease {
            manager: self.clone(),
            owner: owner.into(),
            id: id.into(),
            token,
        })
    }

    pub fn cancel(&self, owner: &str, id: &str) -> AppResult<bool> {
        let registry = self
            .0
            .lock()
            .map_err(|_| AppError::new("scan_state", "无法读取扫描状态。"))?;
        if let Some((active, token)) = registry.jobs.get(owner).filter(|(active, _)| active == id) {
            let _ = active;
            token.cancel();
            return Ok(true);
        }
        if registry.jobs.values().any(|(active, _)| active == id) {
            return Err(AppError::new("scan_owner", "只能停止当前窗口发起的扫描。"));
        }
        Ok(false)
    }

    pub fn close_owner(&self, owner: &str) {
        if let Ok(mut registry) = self.0.lock() {
            registry.closed.insert(owner.to_owned());
            if let Some((_, token)) = registry.jobs.get(owner) {
                token.cancel();
            }
        }
    }

    pub async fn start(
        &self,
        owner: &str,
        request: ScanRequest,
        channel: Channel<ScanUpdate>,
    ) -> AppResult<ScanUpdate> {
        let range = range::parse(&request)?;
        let lease = self.register(owner, &request.scan_id)?;
        let context = match probe::prepare(request.source_address, &lease.token).await {
            Ok(context) => Arc::new(context),
            Err(_) if lease.token.is_cancelled() => {
                return drive(
                    request.scan_id,
                    range,
                    lease.token.clone(),
                    move |update| channel.send(update).is_ok(),
                    |ip| async move { ScanRow::new(ip, AddressStatus::Unfinished, "扫描已停止") },
                )
                .await;
            }
            Err(error) => return Err(error),
        };
        let cancel = lease.token.clone();
        drive(
            request.scan_id,
            range,
            lease.token.clone(),
            move |update| channel.send(update).is_ok(),
            move |ip| {
                let context = context.clone();
                let cancel = cancel.clone();
                async move { probe::target(ip, &context, &cancel).await }
            },
        )
        .await
    }
}

async fn drive<F, Fut>(
    scan_id: String,
    range: range::ScanRange,
    cancel: CancellationToken,
    mut emit: impl FnMut(ScanUpdate) -> bool,
    probe: F,
) -> AppResult<ScanUpdate>
where
    F: Fn(Ipv4Addr) -> Fut,
    Fut: Future<Output = ScanRow>,
{
    let first = range
        .rows
        .first()
        .expect("validated nonempty range")
        .ip
        .parse::<Ipv4Addr>()
        .expect("validated address");
    let mut pending: VecDeque<_> = range
        .rows
        .iter()
        .filter(|row| row.status == AddressStatus::Pending)
        .map(|row| row.ip.parse::<Ipv4Addr>().expect("validated address"))
        .collect();
    let mut update = ScanUpdate {
        scan_id,
        sequence: 0,
        range: range.label,
        phase: ScanPhase::Running,
        total: pending.len(),
        completed: 0,
        rows: range.rows,
    };
    let index = |ip: Ipv4Addr| (u32::from(ip) - u32::from(first)) as usize;
    let mut workers = FuturesUnordered::new();
    for _ in 0..CONCURRENCY {
        if cancel.is_cancelled() {
            break;
        }
        if let Some(ip) = pending.pop_front() {
            update.rows[index(ip)].status = AddressStatus::Scanning;
            update.rows[index(ip)].evidence = "正在探测".into();
            workers.push(probe(ip));
        }
    }
    if !emit(update.clone()) {
        cancel.cancel();
    }
    let mut changes = Vec::new();
    let mut timer = tokio::time::interval(Duration::from_millis(150));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    while !workers.is_empty() {
        tokio::select! {
            row = workers.next() => {
                let Some(row) = row else { break; };
                let slot = index(row.ip.parse().expect("probe address"));
                if !cancel.is_cancelled() {
                    update.rows[slot] = row.clone();
                    changes.push(row);
                    update.completed += 1;
                    if let Some(ip) = pending.pop_front() {
                        let slot = index(ip);
                        update.rows[slot].status = AddressStatus::Scanning;
                        update.rows[slot].evidence = "正在探测".into();
                        changes.push(update.rows[slot].clone());
                        workers.push(probe(ip));
                    }
                }
            },
            _ = timer.tick() => {
                if !changes.is_empty() {
                    update.sequence += 1;
                    let batch = ScanUpdate { rows: std::mem::take(&mut changes), ..update.clone() };
                    if !emit(batch) { cancel.cancel(); }
                }
            }
        }
    }
    update.phase = if cancel.is_cancelled() {
        ScanPhase::Cancelled
    } else {
        ScanPhase::Completed
    };
    for row in &mut update.rows {
        if matches!(row.status, AddressStatus::Pending | AddressStatus::Scanning) {
            row.status = AddressStatus::Unfinished;
            row.evidence = "扫描已停止，尚未完成探测".into();
        }
    }
    update.sequence += 1;
    emit(update.clone());
    Ok(update)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[tokio::test]
    #[ignore = "Runs actual OS ICMP preflight and scans the local interface"]
    async fn native_loopback_scan() {
        let manager = ScanManager::default();
        let request = ScanRequest {
            scan_id: "native-smoke".into(),
            cidr: Some("127.0.0.1/32".into()),
            start_ip: None,
            end_ip: None,
            source_address: None,
        };
        let result = manager
            .start("native-smoke", request, Channel::new(|_| Ok(())))
            .await
            .unwrap();
        assert_eq!(result.phase, ScanPhase::Completed);
        assert_eq!(result.completed, 1);
        assert_eq!(result.rows[0].status, AddressStatus::Occupied);
        assert!(result.rows[0].response_ms.is_some());
    }
    #[test]
    fn leases_enforce_window_ownership_and_closed_windows() {
        let manager = ScanManager::default();
        let lease = manager.register("main", "first").unwrap();
        assert!(manager.register("main", "second").is_err());
        assert!(manager.cancel("detached-1", "first").is_err());
        assert!(manager.cancel("main", "first").unwrap());
        assert!(manager.cancel("main", "first").unwrap());
        assert!(lease.token.is_cancelled());
        drop(lease);
        assert!(manager.register("main", "second").is_ok());
        manager.close_owner("main");
        assert!(manager.register("main", "third").is_err());
    }
    fn request() -> ScanRequest {
        ScanRequest {
            scan_id: "test".into(),
            cidr: Some("192.168.1.0/24".into()),
            start_ip: None,
            end_ip: None,
            source_address: None,
        }
    }
    #[tokio::test]
    async fn scheduling_is_bounded_and_snapshots_are_consistent() {
        let active = AtomicUsize::new(0);
        let max = AtomicUsize::new(0);
        let result = drive(
            "test".into(),
            range::parse(&request()).unwrap(),
            CancellationToken::new(),
            |_| true,
            |ip| {
                let active = &active;
                let max = &max;
                async move {
                    let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max.fetch_max(count, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(1)).await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    ScanRow::new(ip, AddressStatus::Unresponsive, "无响应")
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.phase, ScanPhase::Completed);
        assert_eq!(result.completed, 254);
        assert_eq!(result.rows[0].status, AddressStatus::Reserved);
        assert!(max.load(Ordering::SeqCst) <= CONCURRENCY);
    }
    #[tokio::test]
    async fn mixed_results_keep_numeric_order_and_terminal_counts() {
        let mut request = request();
        request.cidr = None;
        request.start_ip = Some("192.168.0.254".into());
        request.end_ip = Some("192.168.1.2".into());
        let mut updates = Vec::new();
        let result = drive(
            "mixed".into(),
            range::parse(&request).unwrap(),
            CancellationToken::new(),
            |update| {
                updates.push(update);
                true
            },
            |ip| async move {
                let status = match ip.octets()[3] {
                    0 => AddressStatus::Occupied,
                    1 => AddressStatus::Unknown,
                    _ => AddressStatus::Unresponsive,
                };
                ScanRow::new(ip, status, "test")
            },
        )
        .await
        .unwrap();
        assert_eq!(result.completed, 5);
        assert_eq!(result.total, 5);
        assert_eq!(
            result
                .rows
                .iter()
                .filter(|r| r.status == AddressStatus::Unknown)
                .count(),
            1
        );
        assert_eq!(
            result
                .rows
                .iter()
                .map(|r| r.ip.as_str())
                .collect::<Vec<_>>(),
            [
                "192.168.0.254",
                "192.168.0.255",
                "192.168.1.0",
                "192.168.1.1",
                "192.168.1.2"
            ]
        );
        assert_eq!(
            updates
                .iter()
                .filter(|u| u.phase == ScanPhase::Completed)
                .count(),
            1
        );
        assert!(
            updates
                .windows(2)
                .all(|pair| pair[0].sequence < pair[1].sequence)
        );
    }
    #[tokio::test]
    async fn cancellation_retains_completed_results_and_never_greens_unfinished_addresses() {
        let cancel = CancellationToken::new();
        let result = drive(
            "test".into(),
            range::parse(&request()).unwrap(),
            cancel.clone(),
            |_| true,
            |ip| {
                let cancel = cancel.clone();
                async move {
                    cancel.cancel();
                    ScanRow::new(ip, AddressStatus::Unresponsive, "ignored")
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.phase, ScanPhase::Cancelled);
        assert_eq!(result.completed, 0);
        assert!(result.rows.iter().all(|r| matches!(
            r.status,
            AddressStatus::Unfinished | AddressStatus::Reserved
        )));
    }
}
