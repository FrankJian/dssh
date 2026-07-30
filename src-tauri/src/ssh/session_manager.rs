use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use russh::{
    ChannelMsg, Pty,
    client::{self, Handler},
    keys::{PrivateKeyWithHashAlg, decode_secret_key},
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::{Mutex as AsyncMutex, mpsc, oneshot},
};

use crate::{
    error::{AppError, AppResult},
    models::{
        ssh_profile::{AuthMethod, SshProfile, SshProxy},
        terminal::{
            SessionStatus, TerminalOutputEvent, TerminalSession, TerminalSessionKind, TerminalSize,
            TerminalStatusEvent,
        },
    },
    ssh::host_keys::HostKeyVerifier,
    ssh::{ChannelOwner, SshConnectionPool},
};

const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
const TERMINAL_STATUS_EVENT: &str = "terminal-status";
// Grace-period auto-reconnect: after an unexpected drop, keep retrying with
// exponential backoff for up to GRACE before giving up.
const RECONNECT_GRACE: Duration = Duration::from_secs(30);
const RECONNECT_BACKOFF_BASE: Duration = Duration::from_secs(1);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(15);

/// Upper bound (in bytes) for the per-session scrollback we retain server-side
/// so the AI agent can read what is currently on screen. Older output is
/// dropped from the front once this is exceeded.
const MAX_SESSION_BUFFER_BYTES: usize = 200_000;

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    pool: SshConnectionPool,
}

impl SessionManager {
    pub fn new(pool: SshConnectionPool) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pool,
        }
    }
}

#[derive(Debug, Clone)]
struct SessionHandle {
    kind: TerminalSessionKind,
    profile_id: String,
    title: String,
    tx: mpsc::Sender<SessionCommand>,
    /// Accumulated terminal output (with ANSI sequences), capped in size, used
    /// to answer AI `read_terminal` requests about the visible session.
    output: Arc<Mutex<String>>,
}

#[derive(Debug)]
enum SessionCommand {
    Input(String),
    Resize(TerminalSize),
    Close,
    /// Stop retrying during grace-period reconnect and settle as disconnected.
    CancelReconnect,
}

/// Outcome of one connect-and-run attempt for an SSH session.
enum ConnOutcome {
    /// The user closed the session, or the remote shell exited cleanly.
    Closed,
    /// The transport dropped unexpectedly — eligible for grace reconnect.
    Dropped,
}

#[derive(Clone)]
pub struct SshClient {
    verifier: Arc<HostKeyVerifier>,
    host: String,
    port: u16,
    remote_forwards: Option<RemoteForwardTargets>,
}

#[derive(Clone)]
pub(crate) struct RemoteForwardTarget {
    pub local_host: String,
    pub local_port: u16,
}

pub(crate) type RemoteForwardTargets = Arc<AsyncMutex<HashMap<(String, u32), RemoteForwardTarget>>>;

impl SshClient {
    pub fn new(verifier: Arc<HostKeyVerifier>, host: impl Into<String>, port: u16) -> Self {
        Self {
            verifier,
            host: host.into(),
            port,
            remote_forwards: None,
        }
    }

    pub(crate) fn with_remote_forwards(
        verifier: Arc<HostKeyVerifier>,
        host: impl Into<String>,
        port: u16,
        remote_forwards: RemoteForwardTargets,
    ) -> Self {
        Self {
            verifier,
            host: host.into(),
            port,
            remote_forwards: Some(remote_forwards),
        }
    }
}

impl Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
            .to_string();
        Ok(self
            .verifier
            .verify(&self.host, self.port, &fingerprint)
            .await)
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        handle: russh::ChannelOpenHandleInner<client::Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let target = match &self.remote_forwards {
            Some(forwards) => {
                let forwards = forwards.lock().await;
                resolve_remote_forward_target(&forwards, connected_address, connected_port)
            }
            None => None,
        };

        if let Some(target) = target {
            handle.accept().await;
            tokio::spawn(async move {
                let _ = pipe_forwarded_channel(channel, target).await;
            });
        }
        Ok(())
    }
}

fn resolve_remote_forward_target(
    forwards: &HashMap<(String, u32), RemoteForwardTarget>,
    connected_address: &str,
    connected_port: u32,
) -> Option<RemoteForwardTarget> {
    forwards
        .get(&(connected_address.to_string(), connected_port))
        .cloned()
        .or_else(|| {
            let mut matches = forwards
                .iter()
                .filter(|((_, port), _)| *port == connected_port)
                .map(|(_, target)| target.clone());
            let target = matches.next()?;
            matches.next().is_none().then_some(target)
        })
}

impl SessionManager {
    pub fn start_session(
        &self,
        app_handle: AppHandle,
        profile: SshProfile,
        size: TerminalSize,
    ) -> AppResult<TerminalSession> {
        let session_id = create_session_id();
        let profile_id = profile.id.clone();
        let title = profile.name.clone();
        let (tx, rx) = mpsc::channel(256);
        let output = Arc::new(Mutex::new(String::new()));
        self.sessions.lock().map_err(lock_error)?.insert(
            session_id.clone(),
            SessionHandle {
                kind: TerminalSessionKind::Ssh,
                profile_id: profile.id.clone(),
                title: title.clone(),
                tx,
                output: output.clone(),
            },
        );

        let sessions = self.sessions.clone();
        let pool = self.pool.clone();
        let task_session_id = session_id.clone();
        tauri::async_runtime::spawn(async move {
            emit_status(
                &app_handle,
                &task_session_id,
                SessionStatus::Connecting,
                None,
            );

            let result = run_ssh_session(
                app_handle.clone(),
                task_session_id.clone(),
                profile,
                size,
                rx,
                output,
                pool,
            )
            .await;

            if let Err(error) = result {
                emit_status(
                    &app_handle,
                    &task_session_id,
                    SessionStatus::Failed,
                    Some(error.message),
                );
            }

            if let Ok(mut sessions) = sessions.lock() {
                sessions.remove(&task_session_id);
            }
        });

        Ok(TerminalSession {
            id: session_id,
            kind: TerminalSessionKind::Ssh,
            profile_id,
            title,
            status: SessionStatus::Connecting,
        })
    }

    pub fn start_local_session(
        &self,
        app_handle: AppHandle,
        size: TerminalSize,
    ) -> AppResult<TerminalSession> {
        let session_id = create_session_id();
        let title = local_shell_title();
        let (tx, rx) = mpsc::channel(256);
        let output = Arc::new(Mutex::new(String::new()));
        self.sessions.lock().map_err(lock_error)?.insert(
            session_id.clone(),
            SessionHandle {
                kind: TerminalSessionKind::Local,
                profile_id: "local".to_string(),
                title: title.clone(),
                tx,
                output: output.clone(),
            },
        );

        let sessions = self.sessions.clone();
        let task_session_id = session_id.clone();
        thread::spawn(move || {
            emit_status(
                &app_handle,
                &task_session_id,
                SessionStatus::Connecting,
                None,
            );

            let result = run_local_session(
                app_handle.clone(),
                task_session_id.clone(),
                size,
                rx,
                output,
            );

            if let Err(error) = result {
                emit_status(
                    &app_handle,
                    &task_session_id,
                    SessionStatus::Failed,
                    Some(error.message),
                );
            }

            if let Ok(mut sessions) = sessions.lock() {
                sessions.remove(&task_session_id);
            }
        });

        Ok(TerminalSession {
            id: session_id,
            kind: TerminalSessionKind::Local,
            profile_id: "local".to_string(),
            title,
            status: SessionStatus::Connecting,
        })
    }

    pub fn write_session(&self, session_id: &str, data: String) -> AppResult<()> {
        let tx = self.session_tx(session_id)?;
        tx.try_send(SessionCommand::Input(data))
            .map_err(|error| AppError::new("session_send_error", error.to_string()))
    }

    pub fn resize_session(&self, session_id: &str, size: TerminalSize) -> AppResult<()> {
        let tx = self.session_tx(session_id)?;
        tx.try_send(SessionCommand::Resize(size))
            .map_err(|error| AppError::new("session_send_error", error.to_string()))
    }

    pub fn close_session(&self, session_id: &str) -> AppResult<()> {
        let tx = self.session_tx(session_id)?;
        tx.try_send(SessionCommand::Close)
            .map_err(|error| AppError::new("session_send_error", error.to_string()))
    }

    /// Stop an in-progress grace-period reconnect for a session (it settles as
    /// disconnected instead of continuing to retry).
    pub fn cancel_reconnect(&self, session_id: &str) -> AppResult<()> {
        let tx = self.session_tx(session_id)?;
        tx.try_send(SessionCommand::CancelReconnect)
            .map_err(|error| AppError::new("session_send_error", error.to_string()))
    }

    pub fn list_sessions(&self) -> AppResult<Vec<TerminalSession>> {
        let sessions = self.sessions.lock().map_err(lock_error)?;
        Ok(sessions
            .iter()
            .map(|(id, handle)| TerminalSession {
                id: id.clone(),
                kind: handle.kind.clone(),
                profile_id: handle.profile_id.clone(),
                title: handle.title.clone(),
                status: SessionStatus::Connected,
            })
            .collect())
    }

    /// Return the accumulated terminal output (including ANSI sequences) for a
    /// session, so the AI agent can inspect what is currently on screen.
    pub fn read_session_output(&self, session_id: &str) -> AppResult<String> {
        let sessions = self.sessions.lock().map_err(lock_error)?;
        let handle = sessions.get(session_id).ok_or_else(|| {
            AppError::new(
                "session_not_found",
                format!("终端会话 '{session_id}' 不存在或已关闭。"),
            )
        })?;
        let buffer = handle.output.lock().map_err(lock_error)?;
        Ok(buffer.clone())
    }

    fn session_tx(&self, session_id: &str) -> AppResult<mpsc::Sender<SessionCommand>> {
        self.sessions
            .lock()
            .map_err(lock_error)?
            .get(session_id)
            .map(|handle| handle.tx.clone())
            .ok_or_else(|| {
                AppError::new(
                    "session_not_found",
                    format!("SSH session '{session_id}' does not exist."),
                )
            })
    }
}

async fn run_ssh_session(
    app_handle: AppHandle,
    session_id: String,
    profile: SshProfile,
    size: TerminalSize,
    mut rx: mpsc::Receiver<SessionCommand>,
    output: Arc<Mutex<String>>,
    pool: SshConnectionPool,
) -> AppResult<()> {
    let mut size = size;
    // Grace window + backoff are armed only after the first successful connect
    // drops; a failure on the very first attempt is a hard error (as before).
    let mut grace_deadline: Option<Instant> = None;
    let mut backoff = RECONNECT_BACKOFF_BASE;

    loop {
        match connect_and_run(
            &app_handle,
            &session_id,
            &profile,
            &mut size,
            &mut rx,
            &output,
            &pool,
        )
        .await
        {
            Ok(ConnOutcome::Closed) => {
                emit_status(&app_handle, &session_id, SessionStatus::Disconnected, None);
                return Ok(());
            }
            Ok(ConnOutcome::Dropped) => {
                // A live session dropped — start a fresh grace window.
                grace_deadline = None;
                backoff = RECONNECT_BACKOFF_BASE;
            }
            Err(error) => {
                if grace_deadline.is_none() {
                    // Initial connection failure: surfaced as Failed by the caller.
                    return Err(error);
                }
                // A reconnect attempt failed; keep counting toward the deadline.
            }
        }

        let deadline = *grace_deadline.get_or_insert_with(|| Instant::now() + RECONNECT_GRACE);
        if Instant::now() >= deadline {
            emit_status(
                &app_handle,
                &session_id,
                SessionStatus::Failed,
                Some("重连超时，连接已断开。".to_string()),
            );
            return Ok(());
        }

        emit_status(
            &app_handle,
            &session_id,
            SessionStatus::Reconnecting,
            Some("连接已断开，正在尝试重连…".to_string()),
        );

        // Wait out the backoff, but stay responsive to close / cancel; a resize
        // during the wait updates the size the reconnected PTY will request.
        let wait = backoff.min(deadline.saturating_duration_since(Instant::now()));
        let sleep = tokio::time::sleep(wait);
        tokio::pin!(sleep);
        let mut cancelled = false;
        loop {
            tokio::select! {
                _ = &mut sleep => break,
                command = rx.recv() => match command {
                    Some(SessionCommand::Close) | None => {
                        emit_status(&app_handle, &session_id, SessionStatus::Disconnected, None);
                        return Ok(());
                    }
                    Some(SessionCommand::CancelReconnect) => {
                        cancelled = true;
                        break;
                    }
                    Some(SessionCommand::Resize(new_size)) => size = new_size,
                    Some(SessionCommand::Input(_)) => {}
                },
            }
        }
        if cancelled {
            emit_status(
                &app_handle,
                &session_id,
                SessionStatus::Disconnected,
                Some("已取消重连。".to_string()),
            );
            return Ok(());
        }
        backoff = (backoff * 2).min(RECONNECT_BACKOFF_MAX);
    }
}

/// Establish one SSH connection, attach a PTY + shell, and pump I/O until the
/// user closes it, the remote shell exits cleanly, or the transport drops.
/// The read side runs in its own task (keeping the decode loop intact); the
/// write side is driven from a select loop so it can react to a drop.
// Every parameter is a distinct piece of per-attempt state that the reconnect
// loop owns and re-supplies on each retry; bundling them into a struct would
// only move the same fields behind an extra indirection.
#[allow(clippy::too_many_arguments)]
async fn connect_and_run(
    app_handle: &AppHandle,
    session_id: &str,
    profile: &SshProfile,
    size: &mut TerminalSize,
    rx: &mut mpsc::Receiver<SessionCommand>,
    output: &Arc<Mutex<String>>,
    pool: &SshConnectionPool,
) -> AppResult<ConnOutcome> {
    let transport = pool
        .acquire(profile.clone(), ChannelOwner::Terminal)
        .await?;
    let (channel, _channel_lease) = transport.open_session_channel().await?;
    channel
        .request_pty(
            true,
            "xterm-256color",
            size.cols.into(),
            size.rows.into(),
            0,
            0,
            terminal_modes(),
        )
        .await
        .map_err(ssh_error)?;
    channel.request_shell(true).await.map_err(ssh_error)?;
    emit_status(app_handle, session_id, SessionStatus::Connected, None);
    // The remote shell paints its own prompt on attach; the frontend's initial
    // fit sends a window-change (SIGWINCH) which triggers a repaint for shells
    // that need one. Sending an extra newline here would echo a duplicate
    // prompt, so we intentionally do not nudge the shell.
    let (mut reader, writer) = channel.split();

    // The read task signals completion via the oneshot: `true` = clean shell
    // exit (do not reconnect), `false`/dropped = transport lost.
    let (drop_tx, mut drop_rx) = oneshot::channel::<bool>();
    let read_app_handle = app_handle.clone();
    let read_session_id = session_id.to_string();
    let read_output = output.clone();
    let read_task = tauri::async_runtime::spawn(async move {
        let mut utf8_carry: Vec<u8> = Vec::new();
        let mut clean_exit = false;
        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let text = decode_with_carry(&mut utf8_carry, &data);
                    if !text.is_empty() {
                        push_session_output(&read_output, &text);
                        emit_output(&read_app_handle, &read_session_id, text);
                    }
                }
                Some(ChannelMsg::ExitStatus { .. }) => clean_exit = true,
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
        let _ = drop_tx.send(clean_exit);
    });

    let outcome = loop {
        tokio::select! {
            command = rx.recv() => match command {
                Some(SessionCommand::Input(data)) => {
                    if writer.data_bytes(normalize_input(&data)).await.is_err() {
                        break ConnOutcome::Dropped;
                    }
                }
                Some(SessionCommand::Resize(new_size)) => {
                    let _ = writer
                        .window_change(new_size.cols.into(), new_size.rows.into(), 0, 0)
                        .await;
                    *size = new_size;
                }
                Some(SessionCommand::Close) | None => {
                    let _ = writer.close().await;
                    break ConnOutcome::Closed;
                }
                Some(SessionCommand::CancelReconnect) => {}
            },
            result = &mut drop_rx => {
                break match result {
                    Ok(true) => ConnOutcome::Closed,
                    _ => ConnOutcome::Dropped,
                };
            }
        }
    };

    read_task.abort();
    if matches!(outcome, ConnOutcome::Dropped) {
        transport.invalidate().await;
    }
    Ok(outcome)
}

fn run_local_session(
    app_handle: AppHandle,
    session_id: String,
    size: TerminalSize,
    mut rx: mpsc::Receiver<SessionCommand>,
    output: Arc<Mutex<String>>,
) -> AppResult<()> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(&size))
        .map_err(local_terminal_error)?;
    let shell = default_shell();
    let mut command = CommandBuilder::new(shell.program);
    command.args(shell.args);
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(local_terminal_error)?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(local_terminal_error)?;
    let mut writer = pair.master.take_writer().map_err(local_terminal_error)?;
    let read_app_handle = app_handle.clone();
    let read_session_id = session_id.clone();
    let read_output = output.clone();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut utf8_carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let text = decode_with_carry(&mut utf8_carry, &buffer[..size]);
                    if !text.is_empty() {
                        push_session_output(&read_output, &text);
                        emit_output(&read_app_handle, &read_session_id, text);
                    }
                }
                Err(_) => break,
            }
        }
    });

    emit_status(&app_handle, &session_id, SessionStatus::Connected, None);

    while let Some(command) = rx.blocking_recv() {
        match command {
            SessionCommand::Input(data) => {
                writer
                    .write_all(data.as_bytes())
                    .and_then(|_| writer.flush())
                    .map_err(local_terminal_error)?;
            }
            SessionCommand::Resize(size) => {
                pair.master
                    .resize(pty_size(&size))
                    .map_err(local_terminal_error)?;
            }
            SessionCommand::Close => {
                emit_status(&app_handle, &session_id, SessionStatus::Disconnecting, None);
                let _ = child.kill();
                break;
            }
            // Local sessions never reconnect, so this is a no-op.
            SessionCommand::CancelReconnect => {}
        }
    }

    let _ = child.kill();
    let _ = reader_thread.join();
    emit_status(&app_handle, &session_id, SessionStatus::Disconnected, None);
    Ok(())
}

pub(crate) async fn connect_ssh_with_client(
    config: Arc<client::Config>,
    profile: &SshProfile,
    client: SshClient,
) -> AppResult<client::Handle<SshClient>> {
    let address = (profile.host.as_str(), profile.port);

    match &profile.proxy {
        None => client::connect(config, address, client)
            .await
            .map_err(ssh_error),
        Some(proxy) => {
            let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port))
                .await
                .map_err(proxy_error)?;
            stream.set_nodelay(true).map_err(proxy_error)?;
            match proxy.proxy_type.as_str() {
                "socks5" => {
                    establish_socks5_tunnel(&mut stream, proxy, &profile.host, profile.port).await?
                }
                "http" => {
                    establish_http_tunnel(&mut stream, proxy, &profile.host, profile.port).await?
                }
                _ => return Err(AppError::new("proxy_error", "不支持的代理类型。")),
            }
            client::connect_stream(config, stream, client)
                .await
                .map_err(ssh_error)
        }
    }
}

async fn pipe_forwarded_channel(
    channel: russh::Channel<client::Msg>,
    target: RemoteForwardTarget,
) -> std::io::Result<()> {
    let mut outbound = TcpStream::connect((target.local_host.as_str(), target.local_port)).await?;
    let mut stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut outbound).await?;
    Ok(())
}

async fn establish_socks5_tunnel(
    stream: &mut TcpStream,
    proxy: &SshProxy,
    host: &str,
    port: u16,
) -> AppResult<()> {
    let needs_auth = proxy.username.is_some() || proxy.password.is_some();
    stream
        .write_all(if needs_auth {
            &[5, 2, 0, 2]
        } else {
            &[5, 1, 0]
        })
        .await
        .map_err(proxy_error)?;
    let mut response = [0_u8; 2];
    stream
        .read_exact(&mut response)
        .await
        .map_err(proxy_error)?;
    if response[0] != 5 || response[1] == 0xFF {
        return Err(AppError::new("proxy_error", "SOCKS5 代理拒绝认证方式。"));
    }
    if response[1] == 2 {
        let username = proxy.username.as_deref().unwrap_or_default().as_bytes();
        let password = proxy.password.as_deref().unwrap_or_default().as_bytes();
        if username.len() > 255 || password.len() > 255 {
            return Err(AppError::new(
                "proxy_error",
                "SOCKS5 代理用户名或密码过长。",
            ));
        }
        let mut auth = vec![1, username.len() as u8];
        auth.extend_from_slice(username);
        auth.push(password.len() as u8);
        auth.extend_from_slice(password);
        stream.write_all(&auth).await.map_err(proxy_error)?;
        stream
            .read_exact(&mut response)
            .await
            .map_err(proxy_error)?;
        if response != [1, 0] {
            return Err(AppError::new("proxy_error", "SOCKS5 代理认证失败。"));
        }
    } else if response[1] != 0 {
        return Err(AppError::new(
            "proxy_error",
            "SOCKS5 代理使用了不支持的认证方式。",
        ));
    }
    let host_bytes = host.as_bytes();
    if host_bytes.len() > 255 {
        return Err(AppError::new("proxy_error", "目标主机名过长。"));
    }
    let mut request = vec![5, 1, 0, 3, host_bytes.len() as u8];
    request.extend_from_slice(host_bytes);
    request.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&request).await.map_err(proxy_error)?;
    stream
        .read_exact(&mut response)
        .await
        .map_err(proxy_error)?;
    if response[0] != 5 || response[1] != 0 {
        return Err(AppError::new(
            "proxy_error",
            format!("SOCKS5 连接目标失败（错误码 {}）。", response[1]),
        ));
    }
    let mut address_header = [0_u8; 2]; // reserved byte, followed by address type
    stream
        .read_exact(&mut address_header)
        .await
        .map_err(proxy_error)?;
    if address_header[0] != 0 {
        return Err(AppError::new("proxy_error", "SOCKS5 响应无效。"));
    }
    let address_length = match address_header[1] {
        1 => 4,
        3 => {
            let mut length = [0_u8; 1];
            stream.read_exact(&mut length).await.map_err(proxy_error)?;
            usize::from(length[0])
        }
        4 => 16,
        _ => return Err(AppError::new("proxy_error", "SOCKS5 响应无效。")),
    };
    let mut discard = vec![0_u8; address_length + 2];
    stream.read_exact(&mut discard).await.map_err(proxy_error)?;
    Ok(())
}

async fn establish_http_tunnel(
    stream: &mut TcpStream,
    proxy: &SshProxy,
    host: &str,
    port: u16,
) -> AppResult<()> {
    let authority = format!("{host}:{port}");
    let authorization = match (&proxy.username, &proxy.password) {
        (Some(username), password) => format!(
            "Proxy-Authorization: Basic {}\r\n",
            BASE64.encode(format!(
                "{}:{}",
                username,
                password.as_deref().unwrap_or_default()
            ))
        ),
        _ => String::new(),
    };
    stream
        .write_all(
            format!(
                "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: Keep-Alive\r\n{authorization}\r\n"
            )
            .as_bytes(),
        )
        .await
        .map_err(proxy_error)?;
    let mut headers = Vec::new();
    while headers.len() < 16 * 1024 {
        let byte = stream.read_u8().await.map_err(proxy_error)?;
        headers.push(byte);
        if headers.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let response = String::from_utf8_lossy(&headers);
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return Err(AppError::new(
            "proxy_error",
            format!(
                "HTTP 代理连接失败：{}",
                response.lines().next().unwrap_or("无响应")
            ),
        ));
    }
    Ok(())
}

pub async fn authenticate<H: client::Handler>(
    handle: &mut client::Handle<H>,
    profile: &SshProfile,
) -> AppResult<()> {
    let result = match &profile.auth_method {
        AuthMethod::Password { secret_ref } => {
            let password = secret_ref.as_deref().ok_or_else(|| {
                AppError::new("auth_error", "Password is required for this SSH profile.")
            })?;
            handle
                .authenticate_password(profile.username.clone(), password.to_string())
                .await
                .map_err(ssh_error)?
        }
        AuthMethod::PrivateKey {
            key_data,
            passphrase_ref,
            ..
        } => {
            let key_data = key_data.as_deref().ok_or_else(|| {
                AppError::new(
                    "auth_error",
                    "This SSH profile does not have an uploaded key.",
                )
            })?;
            let key_pair =
                decode_secret_key(key_data, passphrase_ref.as_deref()).map_err(ssh_error)?;
            let key = PrivateKeyWithHashAlg::new(
                Arc::new(key_pair),
                handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(ssh_error)?
                    .flatten(),
            );
            handle
                .authenticate_publickey(profile.username.clone(), key)
                .await
                .map_err(ssh_error)?
        }
    };

    if result.success() {
        Ok(())
    } else {
        Err(AppError::new("auth_error", "SSH authentication failed."))
    }
}

/// Append a chunk of terminal output to the retained scrollback, dropping the
/// oldest bytes (on a UTF-8 boundary) once the cap is exceeded.
fn push_session_output(output: &Arc<Mutex<String>>, text: &str) {
    if let Ok(mut buffer) = output.lock() {
        buffer.push_str(text);
        if buffer.len() > MAX_SESSION_BUFFER_BYTES {
            let mut cut = buffer.len() - MAX_SESSION_BUFFER_BYTES;
            while cut < buffer.len() && !buffer.is_char_boundary(cut) {
                cut += 1;
            }
            buffer.drain(..cut);
        }
    }
}

fn emit_output(app_handle: &AppHandle, session_id: &str, data: String) {
    let _ = app_handle.emit(
        TERMINAL_OUTPUT_EVENT,
        TerminalOutputEvent {
            session_id: session_id.to_string(),
            data,
        },
    );
}

fn emit_status(
    app_handle: &AppHandle,
    session_id: &str,
    status: SessionStatus,
    message: Option<String>,
) {
    let _ = app_handle.emit(
        TERMINAL_STATUS_EVENT,
        TerminalStatusEvent {
            session_id: session_id.to_string(),
            status,
            message,
        },
    );
}

struct LocalShell {
    program: String,
    args: Vec<String>,
}

fn default_shell() -> LocalShell {
    if cfg!(windows) {
        LocalShell {
            program: env::var("DSHELL").unwrap_or_else(|_| "powershell.exe".to_string()),
            args: vec!["-NoLogo".to_string()],
        }
    } else {
        LocalShell {
            program: env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()),
            args: Vec::new(),
        }
    }
}

fn local_shell_title() -> String {
    if cfg!(windows) {
        "本地终端".to_string()
    } else {
        env::var("SHELL")
            .ok()
            .and_then(|shell| {
                PathBuf::from(shell)
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "本地终端".to_string())
    }
}

fn pty_size(size: &TerminalSize) -> PtySize {
    PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Preserve xterm input exactly. The requested SSH PTY enables ICRNL so normal
/// shells receive Enter as a line feed, while full-screen TUI programs running
/// in raw mode (such as `pi /login`) retain the carriage return they use to
/// confirm a selected option.
fn normalize_input(data: &str) -> Vec<u8> {
    data.as_bytes().to_vec()
}

/// Decode a stream of PTY bytes into UTF-8 text while tolerating multi-byte
/// characters (e.g. CJK) that are split across packet boundaries. Any trailing
/// incomplete sequence is held in `carry` until the next chunk arrives;
/// genuinely invalid bytes are replaced so the stream never stalls.
fn decode_with_carry(carry: &mut Vec<u8>, incoming: &[u8]) -> String {
    carry.extend_from_slice(incoming);
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(text) => {
                out.push_str(text);
                carry.clear();
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    out.push_str(std::str::from_utf8(&carry[..valid]).unwrap_or_default());
                    carry.drain(..valid);
                    continue;
                }
                match error.error_len() {
                    Some(invalid_len) => {
                        out.push('\u{FFFD}');
                        carry.drain(..invalid_len);
                        continue;
                    }
                    None => break,
                }
            }
        }
    }
    out
}

fn terminal_modes() -> &'static [(Pty, u32)] {
    &[
        (Pty::VINTR, 3),
        (Pty::VQUIT, 28),
        (Pty::VERASE, 127),
        (Pty::VKILL, 21),
        (Pty::VEOF, 4),
        (Pty::VSTART, 17),
        (Pty::VSTOP, 19),
        (Pty::VSUSP, 26),
        (Pty::ICRNL, 1),
        (Pty::IXON, 1),
        (Pty::ISIG, 1),
        (Pty::ICANON, 1),
        (Pty::ECHO, 1),
        (Pty::ECHOE, 1),
        (Pty::ECHOK, 1),
        (Pty::IEXTEN, 1),
        (Pty::OPOST, 1),
        (Pty::ONLCR, 1),
        (Pty::CS8, 1),
        (Pty::TTY_OP_ISPEED, 38400),
        (Pty::TTY_OP_OSPEED, 38400),
    ]
}

fn create_session_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("session-{millis}")
}

pub fn ssh_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("ssh_error", error.to_string())
}

fn proxy_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("proxy_error", error.to_string())
}

fn local_terminal_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("local_terminal_error", error.to_string())
}

fn lock_error(error: impl std::fmt::Display) -> AppError {
    AppError::new("state_lock_error", error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{RemoteForwardTarget, normalize_input, resolve_remote_forward_target};

    #[test]
    fn terminal_input_preserves_carriage_return_for_raw_mode_programs() {
        assert_eq!(normalize_input("\r"), b"\r");
        assert_eq!(normalize_input("\r\n"), b"\r\n");
    }

    #[test]
    fn remote_forward_target_prefers_exact_route_and_rejects_ambiguous_fallback() {
        let mut forwards = HashMap::new();
        forwards.insert(
            ("127.0.0.1".to_string(), 8080),
            RemoteForwardTarget {
                local_host: "localhost".to_string(),
                local_port: 3000,
            },
        );
        forwards.insert(
            ("0.0.0.0".to_string(), 8080),
            RemoteForwardTarget {
                local_host: "localhost".to_string(),
                local_port: 4000,
            },
        );

        let exact = resolve_remote_forward_target(&forwards, "127.0.0.1", 8080)
            .expect("exact route should resolve");
        assert_eq!(exact.local_port, 3000);
        assert!(resolve_remote_forward_target(&forwards, "localhost", 8080).is_none());

        forwards.remove(&("0.0.0.0".to_string(), 8080));
        let fallback = resolve_remote_forward_target(&forwards, "localhost", 8080)
            .expect("a unique port fallback should resolve");
        assert_eq!(fallback.local_port, 3000);
    }
}
