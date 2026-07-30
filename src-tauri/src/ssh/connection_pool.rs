//! Shared SSH transport contract and diagnostics.
//!
//! Callers describe a transport using [`ConnectionKey`], then own one or more
//! independent SSH channels through a lease. Credentials never become part of
//! a key or a diagnostic record; a saved profile id plus its persisted version
//! keeps changed profiles isolated without copying secrets into
//! frontend-visible state.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use russh::{Disconnect, client};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Notify};

use crate::{
    error::{AppError, AppResult},
    models::ssh_profile::{AuthMethod, SshProfile},
    ssh::{
        HostKeyVerifier,
        session_manager::{
            RemoteForwardTarget, RemoteForwardTargets, SshClient, authenticate,
            connect_ssh_with_client, ssh_error,
        },
    },
};

/// Hard upper bound for concurrently open channels on one shared transport.
/// Servers may enforce a lower `MaxSessions`; consumers must turn a refused
/// channel open into their own scoped error without closing unrelated work.
pub const DEFAULT_MAX_CHANNELS_PER_TRANSPORT: usize = 32;

/// Time a transport is eligible to remain alive after its final lease is
/// returned. The pool periodically reaps eligible transports.
pub const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 90;
const IDLE_REAPER_INTERVAL: Duration = Duration::from_secs(15);
const RECONNECT_GRACE: Duration = Duration::from_secs(30);
const RECONNECT_BACKOFF_BASE: Duration = Duration::from_secs(1);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(15);
pub const SSH_TRANSPORT_STATUS_EVENT: &str = "ssh://transport-status";

/// Returned to short-lived consumers when their channel ends because the
/// pooled transport is being rebuilt. The caller must not retry a mutating
/// operation automatically; it can safely ask the user to retry instead.
pub fn transport_recovering_error() -> AppError {
    AppError::new(
        "ssh_transport_reconnecting",
        "共享 SSH 连接已中断，正在恢复。请稍后重试该操作。",
    )
}

fn next_reconnect_backoff(backoff: Duration) -> Duration {
    (backoff * 2).min(RECONNECT_BACKOFF_MAX)
}

/// The feature that owns an SSH channel. A consumer only owns its channel: it
/// must never disconnect a shared transport when its own work ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChannelOwner {
    Terminal,
    Sftp,
    Exec,
    Forward,
}

/// Authentication method identity without authentication material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AuthKind {
    Password,
    PrivateKey,
}

/// A non-secret identity for a reusable SSH transport.
///
/// `profile_id` keeps separately saved profiles isolated even if their visible
/// host details match. `profile_version` changes after every persisted profile
/// update, which means a configuration or credential update cannot attach new
/// channels to an older authenticated transport.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct ConnectionKey {
    profile_id: String,
    profile_version: String,
    host: String,
    port: u16,
    username: String,
    auth_kind: AuthKind,
    proxy: Option<ProxyKey>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct ProxyKey {
    proxy_type: String,
    host: String,
    port: u16,
    username: Option<String>,
}

impl ConnectionKey {
    pub fn from_profile(profile: &SshProfile) -> Self {
        let auth_kind = match &profile.auth_method {
            AuthMethod::Password { .. } => AuthKind::Password,
            AuthMethod::PrivateKey { .. } => AuthKind::PrivateKey,
        };
        let proxy = profile.proxy.as_ref().map(|proxy| ProxyKey {
            proxy_type: proxy.proxy_type.clone(),
            host: proxy.host.clone(),
            port: proxy.port,
            username: proxy.username.clone(),
        });

        Self {
            profile_id: profile.id.clone(),
            profile_version: profile.updated_at.clone(),
            host: profile.host.clone(),
            port: profile.port,
            username: profile.username.clone(),
            auth_kind,
            proxy,
        }
    }

    /// The profile that owns this configuration. This is intentionally the
    /// only key data exposed outside the SSH backend.
    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }
}

/// Lifecycle states reported internally by the future pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Connecting,
    Ready,
    Reconnecting,
    Failed,
}

/// A transport lifecycle notification. It includes only the saved profile id
/// and a generic status/message; host names and authentication material stay
/// inside the Rust backend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTransportStatusEvent {
    pub profile_id: String,
    pub state: ConnectionState,
    pub message: Option<String>,
}

/// Counters used to compare the old independent connections with pool-backed
/// consumers. The snapshot is safe to expose in debug tooling because it never
/// carries endpoint names, profile ids, or credentials.
#[derive(Default)]
pub struct SshConnectionDiagnostics {
    handshake_attempts: AtomicU64,
    transports_opened: AtomicU64,
    transports_closed: AtomicU64,
    channels_opened: AtomicU64,
    channels_closed: AtomicU64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionDiagnosticsSnapshot {
    pub handshake_attempts: u64,
    pub transports_opened: u64,
    pub transports_closed: u64,
    pub channels_opened: u64,
    pub channels_closed: u64,
}

impl SshConnectionDiagnostics {
    pub fn record_handshake_attempt(&self) {
        self.handshake_attempts.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_transport_opened(&self) {
        self.transports_opened.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_transport_closed(&self) {
        self.transports_closed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_channel_opened(&self, _owner: ChannelOwner) {
        self.channels_opened.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_channel_closed(&self, _owner: ChannelOwner) {
        self.channels_closed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> SshConnectionDiagnosticsSnapshot {
        SshConnectionDiagnosticsSnapshot {
            handshake_attempts: self.handshake_attempts.load(Ordering::Relaxed),
            transports_opened: self.transports_opened.load(Ordering::Relaxed),
            transports_closed: self.transports_closed.load(Ordering::Relaxed),
            channels_opened: self.channels_opened.load(Ordering::Relaxed),
            channels_closed: self.channels_closed.load(Ordering::Relaxed),
        }
    }
}

/// A shared transport manager. It is intentionally Rust-only: consumers get a
/// [`ConnectionLease`] and never receive raw credentials or the transport key.
#[derive(Clone)]
pub struct SshConnectionPool {
    inner: Arc<PoolInner>,
}

struct PoolInner {
    entries: Mutex<HashMap<ConnectionKey, Arc<PoolEntry>>>,
    host_keys: Arc<HostKeyVerifier>,
    diagnostics: Arc<SshConnectionDiagnostics>,
    idle_timeout: Duration,
    max_channels: usize,
    app_handle: AppHandle,
}

struct PoolEntry {
    profile: SshProfile,
    state: Mutex<EntryState>,
    handle: Mutex<Option<client::Handle<SshClient>>>,
    ready: Notify,
    leases: AtomicUsize,
    channels: AtomicUsize,
    transport_closed: AtomicBool,
    reconnect_started: AtomicBool,
    last_released: StdMutex<Instant>,
    remote_forwards: RemoteForwardTargets,
}

#[derive(Clone)]
enum EntryState {
    Connecting,
    Ready,
    Reconnecting,
    Failed(PoolFailure),
}

#[derive(Clone)]
struct PoolFailure {
    code: String,
    message: String,
}

impl PoolFailure {
    fn from_error(error: &AppError) -> Self {
        Self {
            code: error.code.clone(),
            message: error.message.clone(),
        }
    }

    fn into_error(self) -> AppError {
        AppError::new(self.code, self.message)
    }
}

/// One consumer's claim on a shared transport. Dropping it only returns that
/// consumer's reference; it cannot disconnect channels belonging to others.
pub struct ConnectionLease {
    pool: SshConnectionPool,
    key: ConnectionKey,
    entry: Arc<PoolEntry>,
    owner: ChannelOwner,
    diagnostics: Arc<SshConnectionDiagnostics>,
    max_channels: usize,
}

/// A permit coupled to one channel opened through a [`ConnectionLease`]. Keep
/// it alive alongside the raw russh channel; dropping it frees one channel slot
/// without affecting the underlying transport.
pub struct ChannelLease {
    entry: Arc<PoolEntry>,
    owner: ChannelOwner,
    diagnostics: Arc<SshConnectionDiagnostics>,
    opened: AtomicBool,
    released: AtomicBool,
}

impl SshConnectionPool {
    pub fn new(
        host_keys: Arc<HostKeyVerifier>,
        diagnostics: Arc<SshConnectionDiagnostics>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            inner: Arc::new(PoolInner {
                entries: Mutex::new(HashMap::new()),
                host_keys,
                diagnostics,
                idle_timeout: Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS),
                max_channels: DEFAULT_MAX_CHANNELS_PER_TRANSPORT,
                app_handle,
            }),
        }
    }

    /// Acquire a transport lease, coalescing concurrent handshakes for the
    /// exact same saved profile version. Failed attempts are removed before the
    /// error is returned, so retrying never attaches to a half-initialized
    /// entry.
    pub async fn acquire(
        &self,
        profile: SshProfile,
        owner: ChannelOwner,
    ) -> AppResult<ConnectionLease> {
        self.evict_idle().await;
        let key = ConnectionKey::from_profile(&profile);

        let (entry, should_connect) = {
            let mut entries = self.inner.entries.lock().await;
            if let Some(entry) = entries.get(&key) {
                (entry.clone(), false)
            } else {
                let entry = Arc::new(PoolEntry::new(profile.clone()));
                entries.insert(key.clone(), entry.clone());
                self.emit_state(&key, ConnectionState::Connecting, None);
                (entry, true)
            }
        };

        if should_connect {
            return self.connect_entry(key, entry, profile, owner).await;
        }

        match entry.wait_until_ready().await {
            Ok(()) => Ok(self.lease(key, entry, owner)),
            Err(error) => {
                self.remove_if_same(&key, &entry).await;
                Err(error.into_error())
            }
        }
    }

    pub fn diagnostics(&self) -> Arc<SshConnectionDiagnostics> {
        self.inner.diagnostics.clone()
    }

    fn emit_state(&self, key: &ConnectionKey, state: ConnectionState, message: Option<String>) {
        let _ = self.inner.app_handle.emit(
            SSH_TRANSPORT_STATUS_EVENT,
            SshTransportStatusEvent {
                profile_id: key.profile_id().to_string(),
                state,
                message,
            },
        );
    }

    /// Start periodic idle eviction once during application initialization.
    /// The task only holds a weak reference, so it cannot keep the pool alive
    /// after application shutdown.
    pub fn start_idle_reaper(&self) {
        let inner = Arc::downgrade(&self.inner);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(IDLE_REAPER_INTERVAL).await;
                let Some(inner) = inner.upgrade() else {
                    return;
                };
                SshConnectionPool { inner }.evict_idle().await;
            }
        });
    }

    async fn connect_entry(
        &self,
        key: ConnectionKey,
        entry: Arc<PoolEntry>,
        profile: SshProfile,
        owner: ChannelOwner,
    ) -> AppResult<ConnectionLease> {
        let result = self.open_authenticated_transport(&entry, &profile).await;

        match result {
            Ok(handle) => {
                *entry.handle.lock().await = Some(handle);
                entry.transport_closed.store(false, Ordering::Release);
                entry.set_state(EntryState::Ready).await;
                self.emit_state(&key, ConnectionState::Ready, None);
                Ok(self.lease(key, entry, owner))
            }
            Err(error) => {
                entry
                    .set_state(EntryState::Failed(PoolFailure::from_error(&error)))
                    .await;
                self.remove_if_same(&key, &entry).await;
                self.emit_state(&key, ConnectionState::Failed, Some(error.message.clone()));
                Err(error)
            }
        }
    }

    async fn open_authenticated_transport(
        &self,
        entry: &Arc<PoolEntry>,
        profile: &SshProfile,
    ) -> AppResult<client::Handle<SshClient>> {
        self.inner.diagnostics.record_handshake_attempt();
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(24 * 60 * 60)),
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 3,
            ..<_>::default()
        });
        let client = SshClient::with_remote_forwards(
            self.inner.host_keys.clone(),
            profile.host.clone(),
            profile.port,
            entry.remote_forwards.clone(),
        );
        let mut handle = connect_ssh_with_client(config, profile, client).await?;
        self.inner.diagnostics.record_transport_opened();
        if let Err(error) = authenticate(&mut handle, profile).await {
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
            entry.record_transport_closed(&self.inner.diagnostics);
            return Err(error);
        }
        if let Err(error) = entry.restore_remote_forwards(&handle).await {
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
            entry.record_transport_closed(&self.inner.diagnostics);
            return Err(error);
        }
        Ok(handle)
    }

    fn start_reconnect(&self, key: ConnectionKey, entry: Arc<PoolEntry>) {
        let pool = self.clone();
        tauri::async_runtime::spawn(async move {
            let deadline = Instant::now() + RECONNECT_GRACE;
            let mut backoff = RECONNECT_BACKOFF_BASE;
            loop {
                tokio::time::sleep(backoff).await;
                match pool
                    .open_authenticated_transport(&entry, &entry.profile)
                    .await
                {
                    Ok(handle) => {
                        *entry.handle.lock().await = Some(handle);
                        entry.transport_closed.store(false, Ordering::Release);
                        entry.reconnect_started.store(false, Ordering::Release);
                        entry.set_state(EntryState::Ready).await;
                        pool.emit_state(&key, ConnectionState::Ready, None);
                        return;
                    }
                    Err(error) => {
                        if Instant::now() >= deadline {
                            entry.reconnect_started.store(false, Ordering::Release);
                            entry
                                .set_state(EntryState::Failed(PoolFailure::from_error(&error)))
                                .await;
                            pool.remove_if_same(&key, &entry).await;
                            pool.emit_state(
                                &key,
                                ConnectionState::Failed,
                                Some("共享 SSH 连接恢复失败，请重试操作。".to_string()),
                            );
                            return;
                        }
                        pool.emit_state(
                            &key,
                            ConnectionState::Reconnecting,
                            Some("共享 SSH 连接已断开，正在恢复…".to_string()),
                        );
                        backoff = next_reconnect_backoff(backoff);
                    }
                }
            }
        });
    }

    fn lease(
        &self,
        key: ConnectionKey,
        entry: Arc<PoolEntry>,
        owner: ChannelOwner,
    ) -> ConnectionLease {
        entry.leases.fetch_add(1, Ordering::AcqRel);
        ConnectionLease {
            pool: self.clone(),
            key,
            entry,
            owner,
            diagnostics: self.inner.diagnostics.clone(),
            max_channels: self.inner.max_channels,
        }
    }

    async fn remove_if_same(&self, key: &ConnectionKey, target: &Arc<PoolEntry>) {
        let mut entries = self.inner.entries.lock().await;
        if entries
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, target))
        {
            entries.remove(key);
        }
    }

    async fn evict_idle(&self) {
        let now = Instant::now();
        let mut entries = self.inner.entries.lock().await;
        let expired = entries
            .iter()
            .filter_map(|(key, entry)| {
                let idle_since = entry.last_released.lock().ok().map(|value| *value)?;
                (entry.leases.load(Ordering::Acquire) == 0
                    && entry.channels.load(Ordering::Acquire) == 0
                    && now.duration_since(idle_since) >= self.inner.idle_timeout)
                    .then(|| key.clone())
            })
            .collect::<Vec<_>>();
        for key in expired {
            if let Some(entry) = entries.remove(&key) {
                entry.record_transport_closed(&self.inner.diagnostics);
            }
        }
    }
}

impl PoolEntry {
    fn new(profile: SshProfile) -> Self {
        Self {
            profile,
            state: Mutex::new(EntryState::Connecting),
            handle: Mutex::new(None),
            ready: Notify::new(),
            leases: AtomicUsize::new(0),
            channels: AtomicUsize::new(0),
            transport_closed: AtomicBool::new(false),
            reconnect_started: AtomicBool::new(false),
            last_released: StdMutex::new(Instant::now()),
            remote_forwards: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn set_state(&self, state: EntryState) {
        *self.state.lock().await = state;
        self.ready.notify_waiters();
    }

    async fn wait_until_ready(&self) -> Result<(), PoolFailure> {
        loop {
            let notified = self.ready.notified();
            let state = self.state.lock().await.clone();
            match state {
                EntryState::Ready => return Ok(()),
                EntryState::Failed(error) => return Err(error),
                EntryState::Connecting | EntryState::Reconnecting => notified.await,
            }
        }
    }

    fn record_transport_closed(&self, diagnostics: &SshConnectionDiagnostics) {
        if !self.transport_closed.swap(true, Ordering::AcqRel) {
            diagnostics.record_transport_closed();
        }
    }

    async fn restore_remote_forwards(&self, handle: &client::Handle<SshClient>) -> AppResult<()> {
        let routes = self
            .remote_forwards
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for (bind_host, port) in routes {
            handle
                .tcpip_forward(bind_host, port)
                .await
                .map_err(ssh_error)?;
        }
        Ok(())
    }
}

impl ConnectionLease {
    /// Open an independent SSH session channel and reserve one pool channel
    /// slot. The caller must retain the returned [`ChannelLease`] for exactly
    /// as long as the raw `russh::Channel` can still be used.
    pub async fn open_session_channel(
        &self,
    ) -> AppResult<(russh::Channel<client::Msg>, ChannelLease)> {
        let channel_lease = ChannelLease::reserve(
            self.entry.clone(),
            self.owner,
            self.diagnostics.clone(),
            self.max_channels,
        )?;
        let handle = self.entry.handle.lock().await;
        let handle = handle
            .as_ref()
            .ok_or_else(|| AppError::new("ssh_transport_unavailable", "共享 SSH 连接暂不可用。"))?;
        let channel = handle.channel_open_session().await.map_err(ssh_error);
        match channel {
            Ok(channel) => {
                channel_lease.mark_opened();
                Ok((channel, channel_lease))
            }
            Err(error) => {
                drop(channel_lease);
                Err(error)
            }
        }
    }

    /// Open a client-initiated `direct-tcpip` channel for local or dynamic
    /// port forwards. Remote forwards register their server callback route on
    /// the same pooled transport separately.
    pub async fn open_direct_tcpip_channel(
        &self,
        remote_host: String,
        remote_port: u32,
        originator_address: String,
        originator_port: u32,
    ) -> AppResult<(russh::Channel<client::Msg>, ChannelLease)> {
        let channel_lease = ChannelLease::reserve(
            self.entry.clone(),
            self.owner,
            self.diagnostics.clone(),
            self.max_channels,
        )?;
        let handle = self.entry.handle.lock().await;
        let handle = handle
            .as_ref()
            .ok_or_else(|| AppError::new("ssh_transport_unavailable", "共享 SSH 连接暂不可用。"))?;
        let channel = handle
            .channel_open_direct_tcpip(
                remote_host,
                remote_port,
                originator_address,
                originator_port,
            )
            .await
            .map_err(ssh_error);
        match channel {
            Ok(channel) => {
                channel_lease.mark_opened();
                Ok((channel, channel_lease))
            }
            Err(error) => {
                drop(channel_lease);
                Err(error)
            }
        }
    }

    /// Register a remote (`-R`) forward with the pooled client handler and ask
    /// the SSH server to listen. The lease must outlive the registration.
    pub async fn start_remote_forward(
        &self,
        bind_host: String,
        requested_port: u32,
        local_host: String,
        local_port: u16,
    ) -> AppResult<u32> {
        let key = (bind_host.clone(), requested_port);
        self.entry.remote_forwards.lock().await.insert(
            key.clone(),
            RemoteForwardTarget {
                local_host,
                local_port,
            },
        );

        let handle = self.entry.handle.lock().await;
        let Some(handle) = handle.as_ref() else {
            self.entry.remote_forwards.lock().await.remove(&key);
            return Err(AppError::new(
                "ssh_transport_unavailable",
                "共享 SSH 连接暂不可用。",
            ));
        };
        match handle
            .tcpip_forward(bind_host.clone(), requested_port)
            .await
            .map_err(ssh_error)
        {
            Ok(assigned_port) => {
                if assigned_port != requested_port {
                    let mut forwards = self.entry.remote_forwards.lock().await;
                    if let Some(target) = forwards.remove(&key) {
                        forwards.insert((bind_host, assigned_port), target);
                    }
                }
                Ok(assigned_port)
            }
            Err(error) => {
                self.entry.remote_forwards.lock().await.remove(&key);
                Err(error)
            }
        }
    }

    /// Stop one remote listener and remove its callback route only after the
    /// server accepted the cancellation request.
    pub async fn stop_remote_forward(&self, bind_host: String, port: u32) -> AppResult<()> {
        let handle = self.entry.handle.lock().await;
        let handle = handle
            .as_ref()
            .ok_or_else(|| AppError::new("ssh_transport_unavailable", "共享 SSH 连接暂不可用。"))?;
        handle
            .cancel_tcpip_forward(bind_host.clone(), port)
            .await
            .map_err(ssh_error)?;
        self.entry
            .remote_forwards
            .lock()
            .await
            .remove(&(bind_host, port));
        Ok(())
    }

    pub async fn state(&self) -> ConnectionState {
        match self.entry.state.lock().await.clone() {
            EntryState::Connecting => ConnectionState::Connecting,
            EntryState::Ready => ConnectionState::Ready,
            EntryState::Reconnecting => ConnectionState::Reconnecting,
            EntryState::Failed(_) => ConnectionState::Failed,
        }
    }

    /// Remove a transport that has demonstrably dropped from the pool. Existing
    /// channel owners keep their own failure handling, while the next acquire
    /// creates a fresh authenticated transport instead of reusing this one.
    pub async fn invalidate(&self) {
        if self
            .entry
            .reconnect_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        self.entry.set_state(EntryState::Reconnecting).await;
        if let Some(handle) = self.entry.handle.lock().await.take() {
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
        self.entry.record_transport_closed(&self.diagnostics);
        self.pool.emit_state(
            &self.key,
            ConnectionState::Reconnecting,
            Some("共享 SSH 连接已断开，正在恢复…".to_string()),
        );
        self.pool
            .start_reconnect(self.key.clone(), self.entry.clone());
    }
}

impl Drop for ConnectionLease {
    fn drop(&mut self) {
        let previous = self.entry.leases.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "connection lease count underflow");
        if previous == 1
            && let Ok(mut last_released) = self.entry.last_released.lock()
        {
            *last_released = Instant::now();
        }
    }
}

impl ChannelLease {
    fn reserve(
        entry: Arc<PoolEntry>,
        owner: ChannelOwner,
        diagnostics: Arc<SshConnectionDiagnostics>,
        max_channels: usize,
    ) -> AppResult<Self> {
        let mut current = entry.channels.load(Ordering::Acquire);
        loop {
            if current >= max_channels {
                return Err(AppError::new(
                    "ssh_channel_limit",
                    "该 SSH 连接已达到并发 channel 上限。",
                ));
            }
            match entry.channels.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return Ok(Self {
                        entry,
                        owner,
                        diagnostics,
                        opened: AtomicBool::new(false),
                        released: AtomicBool::new(false),
                    });
                }
                Err(next) => current = next,
            }
        }
    }

    pub fn release(&self) {
        if !self.released.swap(true, Ordering::AcqRel) {
            let previous = self.entry.channels.fetch_sub(1, Ordering::AcqRel);
            debug_assert!(previous > 0, "channel lease count underflow");
            if self.opened.swap(false, Ordering::AcqRel) {
                self.diagnostics.record_channel_closed(self.owner);
            }
        }
    }

    fn mark_opened(&self) {
        if !self.opened.swap(true, Ordering::AcqRel) {
            self.diagnostics.record_channel_opened(self.owner);
        }
    }
}

impl Drop for ChannelLease {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ChannelLease, ChannelOwner, ConnectionKey, DEFAULT_IDLE_TIMEOUT_SECS,
        DEFAULT_MAX_CHANNELS_PER_TRANSPORT, PoolEntry, SshConnectionDiagnostics,
    };
    use crate::models::ssh_profile::{AuthMethod, SshProfile, SshProxy};
    use std::sync::Arc;

    fn profile() -> SshProfile {
        SshProfile {
            id: "profile-1".to_string(),
            name: "example".to_string(),
            host: "example.test".to_string(),
            port: 22,
            username: "root".to_string(),
            auth_method: AuthMethod::Password {
                secret_ref: Some("not-used-by-key".to_string()),
            },
            proxy: None,
            description: None,
            favorite: false,
            tags: Vec::new(),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        }
    }

    #[test]
    fn connection_key_changes_when_profile_version_or_route_changes() {
        let original = profile();
        let mut changed_version = original.clone();
        changed_version.updated_at = "2".to_string();
        let mut changed_proxy = original.clone();
        changed_proxy.proxy = Some(SshProxy {
            proxy_type: "http".to_string(),
            host: "proxy.example.test".to_string(),
            port: 8080,
            username: None,
            password: Some("not-used-by-key".to_string()),
        });

        assert!(
            ConnectionKey::from_profile(&original) != ConnectionKey::from_profile(&changed_version)
        );
        assert!(
            ConnectionKey::from_profile(&original) != ConnectionKey::from_profile(&changed_proxy)
        );
        assert_eq!(DEFAULT_MAX_CHANNELS_PER_TRANSPORT, 32);
        assert_eq!(DEFAULT_IDLE_TIMEOUT_SECS, 90);
    }

    #[test]
    fn diagnostics_count_transport_and_channel_lifecycle_without_metadata() {
        let diagnostics = SshConnectionDiagnostics::default();
        diagnostics.record_handshake_attempt();
        diagnostics.record_transport_opened();
        diagnostics.record_channel_opened(ChannelOwner::Exec);
        diagnostics.record_channel_closed(ChannelOwner::Exec);
        diagnostics.record_transport_closed();

        let snapshot = diagnostics.snapshot();
        assert_eq!(snapshot.handshake_attempts, 1);
        assert_eq!(snapshot.transports_opened, 1);
        assert_eq!(snapshot.transports_closed, 1);
        assert_eq!(snapshot.channels_opened, 1);
        assert_eq!(snapshot.channels_closed, 1);
    }

    #[test]
    fn channel_limit_is_scoped_to_one_transport_and_released_on_drop() {
        let entry = Arc::new(PoolEntry::new(profile()));
        let diagnostics = Arc::new(SshConnectionDiagnostics::default());
        let first = ChannelLease::reserve(
            entry.clone(),
            ChannelOwner::Terminal,
            diagnostics.clone(),
            1,
        )
        .expect("first channel slot should be available");

        let error = match ChannelLease::reserve(
            entry.clone(),
            ChannelOwner::Sftp,
            diagnostics.clone(),
            1,
        ) {
            Ok(_) => panic!("a second channel must respect the configured limit"),
            Err(error) => error,
        };
        assert_eq!(error.code, "ssh_channel_limit");

        drop(first);
        let second = ChannelLease::reserve(entry, ChannelOwner::Sftp, diagnostics, 1)
            .expect("dropping the first permit must free the slot");
        drop(second);
    }

    #[test]
    fn channel_diagnostics_only_count_channels_that_opened() {
        let entry = Arc::new(PoolEntry::new(profile()));
        let diagnostics = Arc::new(SshConnectionDiagnostics::default());
        let lease = ChannelLease::reserve(entry, ChannelOwner::Forward, diagnostics.clone(), 1)
            .expect("channel slot should be available");

        assert_eq!(diagnostics.snapshot().channels_opened, 0);
        lease.mark_opened();
        drop(lease);

        let snapshot = diagnostics.snapshot();
        assert_eq!(snapshot.channels_opened, 1);
        assert_eq!(snapshot.channels_closed, 1);
    }

    #[test]
    fn reconnect_backoff_is_exponential_and_capped() {
        assert_eq!(
            super::next_reconnect_backoff(std::time::Duration::from_secs(1)),
            std::time::Duration::from_secs(2)
        );
        assert_eq!(
            super::next_reconnect_backoff(std::time::Duration::from_secs(8)),
            std::time::Duration::from_secs(15)
        );
        assert_eq!(
            super::next_reconnect_backoff(std::time::Duration::from_secs(15)),
            std::time::Duration::from_secs(15)
        );
    }
}
