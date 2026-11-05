mod diagnostics;
mod protocol;
mod secrets;
use diagnostics::{WorkerDiagnostics, WorkerStatus, parse_status};

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    models::app_lock::AppLockStatus,
    models::rdp::{PasswordUpdate, RdpEngineStatus, RdpProfile, RdpSession, SaveRdpProfileRequest},
    storage::ProfileRepository,
};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use zeroize::Zeroizing;

pub const STATUS_EVENT: &str = "rdp://session-status";
#[derive(Clone, Default)]
pub struct RdpManager {
    inner: Arc<Mutex<HashMap<String, Runtime>>>,
    operations: Arc<Mutex<()>>,
    visibility_operations: Arc<Mutex<()>>,
    locked: Arc<AtomicBool>,
}
struct Runtime {
    descriptor: RdpSession,
    owner: String,
    commands: mpsc::Sender<Control>,
}
enum Control {
    Close,
    Focus,
    Visibility {
        locked: bool,
        done: mpsc::Sender<()>,
    },
    Status(WorkerStatus),
    ReaderClosed,
    ProtocolFailed,
}
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// Windows restricts background processes from activating a window. The
// workbench handling the user's click grants only its own worker permission,
// immediately before forwarding that click over the private control pipe.
fn allow_worker_foreground(_process_id: u32) {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        unsafe extern "system" {
            #[link_name = "AllowSetForegroundWindow"]
            fn allow_set_foreground_window(process_id: u32) -> i32;
        }
        // SAFETY: the identifier belongs to the live child owned by this actor;
        // this API takes no pointers and does not transfer process ownership.
        unsafe {
            allow_set_foreground_window(_process_id);
        }
    }
}

fn error(code: &str, message: &str) -> AppError {
    AppError::new(code, message)
}
fn id() -> String {
    format!("rdp:{:032x}", rand::random::<u128>())
}
fn now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn engine_path(app: &AppHandle) -> AppResult<PathBuf> {
    let name = if cfg!(windows) {
        "dssh-rdp-client.exe"
    } else {
        "dssh-rdp-client"
    };
    let path = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("rdp-runtime")
            .join(name)
    } else {
        app.path()
            .resource_dir()
            .map_err(|_| error("rdp_engine_missing", "无法定位 RDP 引擎资源。"))?
            .join("rdp-runtime")
            .join(name)
    };
    if path.is_file() {
        Ok(path)
    } else {
        Err(error(
            "rdp_engine_missing",
            "原生 RDP 引擎尚未构建。开发环境请运行 pnpm rdp:build；发行版请安装包含 RDP 引擎的安装包。",
        ))
    }
}

pub fn engine_status(app: &AppHandle) -> RdpEngineStatus {
    match engine_path(app) {
        Ok(_) => RdpEngineStatus {
            available: true,
            message: "FreeRDP 3.32.2 · 独立原生窗口 · 首版仅直连，剪贴板关闭".into(),
        },
        Err(e) => RdpEngineStatus {
            available: false,
            message: e.message,
        },
    }
}

impl RdpManager {
    pub fn save(
        &self,
        repository: &ProfileRepository,
        mut request: SaveRdpProfileRequest,
    ) -> AppResult<RdpProfile> {
        let _operation = self
            .operations
            .lock()
            .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
        request.profile.normalize_and_validate()?;
        if let Some(source_id) = &request.clone_source_id {
            if !request.profile.id.is_empty() {
                return Err(error("rdp_invalid", "克隆必须创建新的 RDP 连接。"));
            }
            let source = repository
                .get_rdp_profile(source_id)?
                .ok_or_else(|| error("rdp_profile_missing", "原 RDP 连接已删除，无法克隆。"))?;
            if matches!(request.password, PasswordUpdate::Keep {})
                && let Some(reference) = source.secret_ref
            {
                request.password = PasswordUpdate::Replace {
                    value: secrets::read(&reference)?,
                };
            }
        }
        let existing = if request.profile.id.is_empty() {
            None
        } else {
            Some(
                repository
                    .get_rdp_profile(&request.profile.id)?
                    .ok_or_else(|| error("rdp_profile_missing", "RDP 配置已删除，请重新加载。"))?,
            )
        };
        let old_ref = existing.as_ref().and_then(|p| p.secret_ref.clone());
        let mut new_ref = old_ref.clone();
        let mut created_secret = false;
        match request.password {
            PasswordUpdate::Keep {} => {}
            PasswordUpdate::Clear {} => new_ref = None,
            PasswordUpdate::Replace { value } => {
                // Validate before writing anything to the OS credential store.
                let _ = protocol::encode_arguments(&request.profile, &value)?;
                let reference = id();
                secrets::write(&reference, &value)?;
                new_ref = Some(reference);
                created_secret = true;
            }
        }
        request.profile.id = existing
            .as_ref()
            .map(|p| p.profile.id.clone())
            .unwrap_or_else(id);
        request.profile.created_at = existing.map(|p| p.profile.created_at).unwrap_or_else(now);
        request.profile.updated_at = now();
        request.profile.has_password = new_ref.is_some();
        if let Err(e) = repository.save_rdp_profile(&request.profile, new_ref.as_deref()) {
            if created_secret && let Some(reference) = new_ref {
                let _ = secrets::remove(&reference);
            }
            return Err(e);
        }
        if old_ref != new_ref
            && let Some(reference) = old_ref
        {
            let _ = secrets::remove(&reference);
        }
        Ok(request.profile)
    }

    pub fn delete(&self, repository: &ProfileRepository, profile_id: &str) -> AppResult<()> {
        let _operation = self
            .operations
            .lock()
            .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
        let stored = repository.get_rdp_profile(profile_id)?;
        // A failed keychain deletion leaves the profile available for retry.
        if let Some(reference) = stored.and_then(|s| s.secret_ref) {
            secrets::remove(&reference)?;
        }
        repository.delete_rdp_profile(profile_id)
    }

    pub fn list(&self, owner: &str) -> Vec<RdpSession> {
        let Ok(items) = self.inner.lock() else {
            return vec![];
        };
        let mut list = items
            .values()
            .filter(|s| s.owner == owner)
            .map(|s| s.descriptor.clone())
            .collect::<Vec<_>>();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    pub fn control(&self, owner: &str, session_id: &str, close: bool) -> AppResult<()> {
        if !close && self.locked.load(Ordering::Acquire) {
            return Err(error("rdp_locked", "请先解锁 Duo SSH。"));
        }
        let items = self
            .inner
            .lock()
            .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
        let runtime = items
            .get(session_id)
            .filter(|s| s.owner == owner)
            .ok_or_else(|| error("rdp_session_missing", "此桌面不属于当前窗口或已关闭。"))?;
        if matches!(runtime.descriptor.status.as_str(), "closed" | "failed") {
            return Ok(());
        }
        runtime
            .commands
            .send(if close {
                Control::Close
            } else {
                Control::Focus
            })
            .map_err(|_| error("rdp_session_closed", "远程桌面已结束。"))
    }

    pub fn close_owner(&self, owner: Option<&str>) {
        if let Ok(items) = self.inner.lock() {
            for runtime in items
                .values()
                .filter(|r| owner.is_none_or(|o| r.owner == o))
            {
                let _ = runtime.commands.send(Control::Close);
            }
        }
    }

    pub fn update_app_lock(
        &self,
        change: impl FnOnce() -> AppResult<AppLockStatus>,
    ) -> AppResult<AppLockStatus> {
        let _operation = self
            .visibility_operations
            .lock()
            .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
        // Serialize authentication/state mutation with visibility transitions.
        // Otherwise an old unlock racing a newer lock could reveal its workers.
        let status = change()?;
        self.set_locked_inner(status.locked)?;
        Ok(status)
    }

    #[cfg(test)]
    fn set_locked(&self, locked: bool) -> AppResult<()> {
        let _operation = self.visibility_operations.lock().unwrap();
        self.set_locked_inner(locked)
    }

    fn set_locked_inner(&self, locked: bool) -> AppResult<()> {
        if self.locked.swap(locked, Ordering::AcqRel) == locked {
            return Ok(());
        }
        let pending = {
            let items = self
                .inner
                .lock()
                .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
            items
                .values()
                .filter(|runtime| {
                    !matches!(runtime.descriptor.status.as_str(), "closed" | "failed")
                })
                .filter_map(|runtime| {
                    let (done, wait) = mpsc::channel();
                    runtime
                        .commands
                        .send(Control::Visibility { locked, done })
                        .ok()
                        .map(|()| (runtime.descriptor.id.clone(), wait))
                })
                .collect::<Vec<_>>()
        };
        let deadline = Instant::now() + Duration::from_secs(8);
        for (id, wait) in pending {
            match wait.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(()) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // The ack sender can drop before ChildGuard finishes its
                    // kill/wait. Wait for the supervisor's terminal state too.
                    loop {
                        let ended = self
                            .inner
                            .lock()
                            .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?
                            .get(&id)
                            .is_none_or(|runtime| {
                                matches!(runtime.descriptor.status.as_str(), "closed" | "failed")
                            });
                        if ended {
                            break;
                        }
                        if Instant::now() >= deadline {
                            return Err(error("rdp_visibility", "无法确认远程桌面已隐藏或结束。"));
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(error(
                        "rdp_visibility",
                        "远程桌面窗口隐藏或恢复超时，请检查原生引擎。",
                    ));
                }
            }
        }
        Ok(())
    }

    fn update(&self, app: &AppHandle, session_id: &str, status: &str, message: Option<&str>) {
        let event = {
            let Ok(mut items) = self.inner.lock() else {
                return;
            };
            let Some(runtime) = items.get_mut(session_id) else {
                return;
            };
            // A queued connected event may never revive a closing session.
            if runtime.descriptor.status == "disconnecting" && status == "connected" {
                return;
            }
            runtime.descriptor.status = status.into();
            runtime.descriptor.message = message.map(str::to_owned);
            runtime.descriptor.revision += 1;
            (runtime.owner.clone(), runtime.descriptor.clone())
        };
        let _ = app.emit_to(event.0, STATUS_EVENT, event.1);
    }

    pub fn start(
        &self,
        app: AppHandle,
        owner: String,
        profile_id: String,
        password: Option<Zeroizing<String>>,
    ) -> AppResult<RdpSession> {
        let _operation = self
            .operations
            .lock()
            .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
        if let Some(session) = self.list(&owner).into_iter().find(|s| {
            s.profile_id == profile_id
                && matches!(s.status.as_str(), "starting" | "connecting" | "connected")
        }) {
            self.control(&owner, &session.id, false)?;
            return Ok(session);
        }
        let state = app.state::<AppState>();
        let stored = state
            .profiles
            .get_rdp_profile(&profile_id)?
            .ok_or_else(|| error("rdp_profile_missing", "RDP 配置不存在。"))?;
        let mut profile = stored.profile;
        profile.normalize_and_validate()?;
        let binary = engine_path(&app)?;
        let password = match password {
            Some(p) => p,
            None => secrets::read(
                stored
                    .secret_ref
                    .as_deref()
                    .ok_or_else(|| error("rdp_password_required", "请输入本次连接密码。"))?,
            )?,
        };
        let payload = protocol::encode_arguments(&profile, &password)?;
        if state.app_lock.status()?.locked || app.get_webview(&owner).is_none() {
            return Err(error("rdp_access", "工作台已锁定或关闭。"));
        }
        let descriptor = RdpSession {
            id: id(),
            profile_id,
            title: profile.name,
            status: "starting".into(),
            message: None,
            revision: 0,
            certificate_verification_skipped: profile.skip_certificate_verification,
        };
        let (sender, receiver) = mpsc::channel();
        {
            let mut items = self
                .inner
                .lock()
                .map_err(|_| error("rdp_busy", "RDP 管理器暂不可用。"))?;
            // Serialize registration with window-destroy / app-lock cleanup.
            if state.app_lock.status()?.locked || app.get_webview(&owner).is_none() {
                return Err(error("rdp_access", "工作台已锁定或关闭。"));
            }
            // Keep bounded history, without ever removing a running worker.
            items.retain(|_, s| {
                !matches!(s.descriptor.status.as_str(), "closed" | "failed") || s.owner != owner
            });
            if items.len() >= 32 {
                return Err(error("rdp_limit", "远程桌面会话数量已达上限。"));
            }
            items.insert(
                descriptor.id.clone(),
                Runtime {
                    descriptor: descriptor.clone(),
                    owner,
                    commands: sender.clone(),
                },
            );
        }
        let manager = self.clone();
        let session_id = descriptor.id.clone();
        std::thread::spawn(move || {
            if let Err(e) = manager.run_worker(&app, &session_id, binary, payload, sender, receiver)
            {
                manager.update(&app, &session_id, "failed", Some(&e.message));
            }
        });
        Ok(descriptor)
    }

    fn run_worker(
        &self,
        app: &AppHandle,
        session_id: &str,
        binary: PathBuf,
        payload: Zeroizing<Vec<u8>>,
        sender: mpsc::Sender<Control>,
        receiver: mpsc::Receiver<Control>,
    ) -> AppResult<()> {
        let mut command = Command::new(binary);
        // Bundled OpenSSL must use this machine's public trust roots, not build-host paths.
        let roots = rustls_native_certs::load_native_certs();
        let root_path = app
            .path()
            .app_cache_dir()
            .map_err(|_| error("rdp_ca_store", "无法读取本机证书存储。"))?
            .join(format!("rdp-roots-{session_id}.pem").replace(':', "-"));
        std::fs::create_dir_all(
            root_path
                .parent()
                .ok_or_else(|| error("rdp_ca_store", "无法定位证书目录。"))?,
        )?;
        use base64::Engine;
        let pem = roots
            .certs
            .iter()
            .map(|cert| {
                format!(
                    "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
                    base64::engine::general_purpose::STANDARD.encode(cert.as_ref())
                )
            })
            .collect::<String>();
        std::fs::write(&root_path, pem)?;
        struct PublicRoots(PathBuf);
        impl Drop for PublicRoots {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _roots_guard = PublicRoots(root_path.clone());
        command
            .arg("--dssh-worker-v1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear();
        command.env("SSL_CERT_FILE", root_path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW; SDL still owns a GUI window.
        }
        // Do not inherit logging, key-logging, dynamic-loader or ASKPASS overrides.
        for key in [
            "HOME",
            "USERPROFILE",
            "SYSTEMROOT",
            "WINDIR",
            "TEMP",
            "TMP",
            "LANG",
            "LC_CTYPE",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let child = command.spawn().map_err(|_| {
            error(
                "rdp_engine_start",
                "无法启动原生 RDP 引擎，请检查安装包及系统运行库。",
            )
        })?;
        let mut child = ChildGuard(child);
        let mut stdin = child
            .0
            .stdin
            .take()
            .ok_or_else(|| error("rdp_ipc", "无法建立 RDP 私有通道。"))?;
        let stdout = child
            .0
            .stdout
            .take()
            .ok_or_else(|| error("rdp_ipc", "无法读取 RDP 状态。"))?;
        // Only exact, bounded protocol messages are accepted; engine logs are discarded.
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let mut ready = false;
            loop {
                line.clear();
                match reader.by_ref().take(256).read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) if line.len() >= 256 => {
                        let _ = sender.send(Control::ProtocolFailed);
                        break;
                    }
                    Ok(_) => {}
                }
                match parse_status(&line) {
                    Some(WorkerStatus::Ready) if !ready => {
                        ready = true;
                        let _ = sender.send(Control::Status(WorkerStatus::Ready));
                    }
                    Some(status) if ready && status != WorkerStatus::Ready => {
                        let _ = sender.send(Control::Status(status));
                    }
                    _ => {
                        let _ = sender.send(Control::ProtocolFailed);
                        break;
                    }
                }
            }
            let _ = sender.send(Control::ReaderClosed);
        });
        let mut visibility_waiters = Vec::new();
        let handshake_deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(Control::Status(WorkerStatus::Ready)) => break,
                Ok(Control::Visibility { locked, done }) => visibility_waiters.push((locked, done)),
                Ok(Control::Close) => {
                    self.update(app, session_id, "closed", None);
                    return Ok(());
                }
                Ok(Control::ProtocolFailed | Control::ReaderClosed)
                | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(error("rdp_protocol", "RDP 引擎启动握手失败。"));
                }
                _ => {}
            }
            if Instant::now() > handshake_deadline {
                return Err(error("rdp_protocol", "RDP 引擎启动握手超时。"));
            }
        }
        let mut payload = payload;
        if self.locked.load(Ordering::Acquire) {
            let count =
                u32::from_be_bytes(payload[..4].try_into().expect("encoded argument count"));
            payload[..4].copy_from_slice(&(count + 1).to_be_bytes());
            let flag = b"/dssh-initially-hidden";
            payload.extend_from_slice(&(flag.len() as u32).to_be_bytes());
            payload.extend_from_slice(flag);
        }
        stdin
            .write_all(&payload)
            .and_then(|_| stdin.flush())
            .map_err(|_| error("rdp_ipc", "RDP 启动通道已关闭。"))?;
        drop(payload);
        self.update(app, session_id, "connecting", None);
        let started = Instant::now();
        let mut diagnostics = WorkerDiagnostics::default();
        let mut reader_closed = false;
        let mut closing = None;
        let mut visibility_deadline = None;
        if !visibility_waiters.is_empty() || self.locked.load(Ordering::Acquire) {
            stdin
                .write_all(if self.locked.load(Ordering::Acquire) {
                    b"h"
                } else {
                    b"u"
                })
                .and_then(|_| stdin.flush())
                .map_err(|_| error("rdp_ipc", "RDP 控制通道已关闭。"))?;
            visibility_deadline = Some(Instant::now() + Duration::from_secs(2));
        }
        loop {
            if let Some(status) = child
                .0
                .try_wait()
                .map_err(|_| error("rdp_engine_wait", "无法读取远程桌面进程状态。"))?
            {
                // Process exit can win the race against the stdout reader.
                // Drain final structured errors before classifying the exit.
                let deadline = Instant::now() + Duration::from_millis(250);
                while !reader_closed && Instant::now() < deadline {
                    match receiver.recv_timeout(Duration::from_millis(10)) {
                        Ok(Control::Status(status)) => diagnostics.observe(status),
                        Ok(Control::ReaderClosed) => reader_closed = true,
                        Ok(Control::Close) => closing = Some(Instant::now()),
                        _ => {}
                    }
                }
                if (closing.is_some() && diagnostics.is_clean_requested_exit(status.code()))
                    || diagnostics.is_normal_exit(status.code())
                {
                    self.update(app, session_id, "closed", None);
                } else {
                    self.update(
                        app,
                        session_id,
                        "failed",
                        Some(&diagnostics.failure_message(status.code())),
                    );
                }
                return Ok(());
            }
            if closing.is_some_and(|time: Instant| time.elapsed() > Duration::from_secs(2)) {
                let _ = child.0.kill();
                let _ = child.0.wait();
                self.update(app, session_id, "closed", None);
                return Ok(());
            }
            if visibility_deadline.is_some_and(|deadline| Instant::now() > deadline) {
                // Fail closed only when an unresponsive / incompatible engine
                // cannot confirm hiding. Normal locks never end the connection.
                let _ = child.0.kill();
                let _ = child.0.wait();
                visibility_waiters.clear();
                return Err(error(
                    "rdp_visibility",
                    "RDP 引擎未确认窗口隐藏或恢复，请更新完整安装包。",
                ));
            }
            if !diagnostics.connected
                && closing.is_none()
                && started.elapsed() > Duration::from_secs(30)
            {
                return Err(error(
                    "rdp_connect_timeout",
                    "远程桌面连接超时，请检查网络和目标系统。",
                ));
            }
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(Control::Close) if closing.is_none() => {
                    closing = Some(Instant::now());
                    self.update(app, session_id, "disconnecting", None);
                    let _ = stdin.write_all(b"q");
                    let _ = stdin.flush();
                }
                Ok(Control::Focus) => {
                    if !self.locked.load(Ordering::Acquire) {
                        allow_worker_foreground(child.0.id());
                        let _ = stdin.write_all(b"f");
                        let _ = stdin.flush();
                    }
                }
                Ok(Control::Visibility { locked, done }) => {
                    visibility_waiters.push((locked, done));
                    stdin
                        .write_all(if locked { b"h" } else { b"u" })
                        .and_then(|_| stdin.flush())
                        .map_err(|_| error("rdp_ipc", "RDP 控制通道已关闭。"))?;
                    visibility_deadline = Some(Instant::now() + Duration::from_secs(2));
                }
                Ok(Control::Status(status)) => {
                    if let WorkerStatus::Visibility { hidden } = status {
                        visibility_waiters.retain(|(locked, done)| {
                            if *locked == hidden {
                                let _ = done.send(());
                                false
                            } else {
                                true
                            }
                        });
                        if visibility_waiters.is_empty() {
                            visibility_deadline = None;
                        }
                    }
                    diagnostics.observe(status);
                    if status == WorkerStatus::UserClose && closing.is_none() {
                        closing = Some(Instant::now());
                        self.update(app, session_id, "disconnecting", None);
                    }
                    if status == WorkerStatus::Connected && closing.is_none() {
                        self.update(app, session_id, "connected", None);
                    }
                }
                Ok(Control::ReaderClosed) => reader_closed = true,
                Ok(Control::ProtocolFailed) => {
                    return Err(error("rdp_protocol", "RDP 引擎协议不兼容或状态通道异常。"));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod visibility_tests {
    use super::*;

    fn fixture() -> (RdpManager, mpsc::Receiver<Control>) {
        let manager = RdpManager::default();
        let (commands, controls) = mpsc::channel();
        manager.inner.lock().unwrap().insert(
            "rdp:test".into(),
            Runtime {
                descriptor: RdpSession {
                    id: "rdp:test".into(),
                    profile_id: "profile".into(),
                    title: "Desktop".into(),
                    status: "connected".into(),
                    message: None,
                    revision: 4,
                    certificate_verification_skipped: false,
                },
                owner: "main".into(),
                commands,
            },
        );
        (manager, controls)
    }

    fn status(locked: bool) -> AppLockStatus {
        AppLockStatus {
            locked,
            settings: crate::models::app_lock::AppLockSettings {
                enabled: true,
                auto_lock_enabled: false,
                timeout_minutes: 5,
                has_password: true,
            },
        }
    }

    #[test]
    fn lock_mutation_and_visibility_are_serialized_with_unlock() {
        let (manager, controls) = fixture();
        let copy = manager.clone();
        let first = std::thread::spawn(move || copy.update_app_lock(|| Ok(status(true))));
        let Control::Visibility { locked: true, done } =
            controls.recv_timeout(Duration::from_secs(2)).unwrap()
        else {
            panic!("expected hide control");
        };
        let (entered, entry) = mpsc::channel();
        let copy = manager.clone();
        let second = std::thread::spawn(move || {
            copy.update_app_lock(|| {
                entered.send(()).unwrap();
                Ok(status(false))
            })
        });
        assert!(matches!(
            entry.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        done.send(()).unwrap();
        assert!(first.join().unwrap().unwrap().locked);
        entry.recv_timeout(Duration::from_secs(2)).unwrap();
        let Control::Visibility {
            locked: false,
            done,
        } = controls.recv_timeout(Duration::from_secs(2)).unwrap()
        else {
            panic!("expected restore control after hide completed");
        };
        done.send(()).unwrap();
        assert!(!second.join().unwrap().unwrap().locked);
        assert!(
            manager
                .update_app_lock(|| Err(error("invalid_password", "test-only")))
                .is_err()
        );
        assert!(matches!(
            controls.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
    }

    #[test]
    fn missing_ack_waits_for_worker_cleanup() {
        let (manager, controls) = fixture();
        let copy = manager.clone();
        let (finished, result) = mpsc::channel();
        let operation = std::thread::spawn(move || finished.send(copy.set_locked(true)).unwrap());
        let Control::Visibility { done, .. } =
            controls.recv_timeout(Duration::from_secs(2)).unwrap()
        else {
            panic!("expected visibility control");
        };
        drop(done);
        assert!(matches!(
            result.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        manager
            .inner
            .lock()
            .unwrap()
            .get_mut("rdp:test")
            .unwrap()
            .descriptor
            .status = "failed".into();
        result
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        operation.join().unwrap();
    }

    #[test]
    fn locking_waits_for_hide_and_preserves_the_same_session() {
        let (manager, controls) = fixture();
        for locked in [true, false, true, false] {
            let copy = manager.clone();
            let operation = std::thread::spawn(move || copy.set_locked(locked));
            let Control::Visibility {
                locked: requested,
                done,
            } = controls.recv_timeout(Duration::from_secs(2)).unwrap()
            else {
                panic!("lock must send visibility control, never close");
            };
            assert_eq!(requested, locked);
            assert!(
                !operation.is_finished(),
                "lock must wait for native acknowledgement"
            );
            if locked {
                assert!(manager.control("main", "rdp:test", false).is_err());
            }
            done.send(()).unwrap();
            operation.join().unwrap().unwrap();
            let sessions = manager.list("main");
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].id, "rdp:test");
            assert_eq!(sessions[0].status, "connected");
            assert_eq!(sessions[0].revision, 4);
            manager.set_locked(locked).unwrap();
            assert!(matches!(
                controls.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
        }
    }
}

#[cfg(test)]
mod clone_tests {
    use super::*;

    #[test]
    fn clone_creates_a_new_record_and_rejects_overwriting_the_source() {
        // Connection IDs contain ':', which is not valid in Windows directory names.
        let directory =
            std::env::temp_dir().join(format!("dssh-rdp-clone-{:032x}", rand::random::<u128>()));
        let repository = ProfileRepository::initialize(&directory, "test.db").unwrap();
        let manager = RdpManager::default();
        let source = manager.save(&repository, serde_json::from_value(serde_json::json!({
            "profile": {"id":"", "name":"Original", "host":"windows.example.test", "port":3389,
                "username":"user", "domain":"EXAMPLE", "certificateFingerprint":"", "width":1920, "height":1080,
                "favorite":true, "tags":["production"], "description":"Desktop", "hasPassword":false, "createdAt":"", "updatedAt":""},
            "password":{"action":"keep"}
        })).unwrap()).unwrap();
        let mut value = serde_json::json!({"profile":source, "password":{"action":"keep"}, "cloneSourceId":source.id});
        assert!(
            manager
                .save(&repository, serde_json::from_value(value.clone()).unwrap())
                .is_err()
        );
        value["profile"]["id"] = serde_json::json!("");
        value["profile"]["name"] = serde_json::json!("Original 克隆");
        let clone = manager
            .save(&repository, serde_json::from_value(value).unwrap())
            .unwrap();
        assert_ne!(source.id, clone.id);
        assert_eq!(source.host, clone.host);
        assert_eq!(source.domain, clone.domain);
        assert_eq!(source.tags, clone.tags);
        assert!(!clone.has_password);
        manager.delete(&repository, &source.id).unwrap();
        assert!(repository.get_rdp_profile(&clone.id).unwrap().is_some());
        let _ = std::fs::remove_dir_all(directory);
    }
}
