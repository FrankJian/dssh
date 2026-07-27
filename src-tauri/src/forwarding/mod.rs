use std::{
    collections::HashMap,
    net::{Ipv4Addr, Ipv6Addr},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use russh::{Channel, client};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    task::JoinHandle,
};

use crate::{
    error::{AppError, AppResult},
    models::{
        forwarding::{ForwardKind, PortForward, StartPortForwardRequest},
        ssh_profile::SshProfile,
    },
    ssh::HostKeyVerifier,
    ssh::session_manager::{authenticate, ssh_error},
};

/// A russh client handler dedicated to a single tunnel connection.
///
/// For remote (`-R`) forwards the server initiates channels back to us, so the
/// handler keeps the local target it should relay those connections to. Local
/// and dynamic forwards drive channels from our side, so `remote_target` stays
/// `None`.
#[derive(Clone)]
pub struct ForwardHandler {
    remote_target: Option<(String, u16)>,
    verifier: Arc<HostKeyVerifier>,
    host: String,
    port: u16,
}

impl client::Handler for ForwardHandler {
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
        channel: Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        // russh 0.62 added this handle parameter to the trait method.
        _handle: russh::ChannelOpenHandleInner<client::Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some((host, port)) = self.remote_target.clone() {
            tokio::spawn(async move {
                let _ = pipe_channel_to_local(channel, host, port).await;
            });
        }
        Ok(())
    }
}

struct ForwardEntry {
    info: PortForward,
    // Keeping the handle alive keeps the underlying SSH tunnel connection open;
    // dropping it disconnects and tears down every forwarded channel.
    _handle: Arc<client::Handle<ForwardHandler>>,
    // Accept loop for local/dynamic forwards. Remote forwards rely purely on the
    // connection handler, so they have no listener task.
    task: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct ForwardManager {
    forwards: Arc<Mutex<HashMap<String, ForwardEntry>>>,
    host_keys: Arc<HostKeyVerifier>,
}

impl ForwardManager {
    pub fn new(host_keys: Arc<HostKeyVerifier>) -> Self {
        Self {
            forwards: Arc::new(Mutex::new(HashMap::new())),
            host_keys,
        }
    }

    pub async fn start(
        &self,
        profile: &SshProfile,
        request: StartPortForwardRequest,
    ) -> AppResult<PortForward> {
        let id = create_forward_id();

        let info = PortForward {
            id: id.clone(),
            session_id: request.session_id.clone(),
            kind: request.kind,
            local_host: request.local_host.clone(),
            local_port: request.local_port,
            remote_host: request.remote_host.clone(),
            remote_port: request.remote_port,
            description: request.description.clone(),
        };

        let (handle, task) = match request.kind {
            ForwardKind::Local => {
                let listener = bind_listener(&request.local_host, request.local_port).await?;
                let handle =
                    Arc::new(open_connection(profile, None, self.host_keys.clone()).await?);
                let task_handle = handle.clone();
                let remote_host = request.remote_host.clone();
                let remote_port = request.remote_port;
                let task = tokio::spawn(async move {
                    run_local_listener(task_handle, listener, remote_host, remote_port).await;
                });
                (handle, Some(task))
            }
            ForwardKind::Dynamic => {
                let listener = bind_listener(&request.local_host, request.local_port).await?;
                let handle =
                    Arc::new(open_connection(profile, None, self.host_keys.clone()).await?);
                let task_handle = handle.clone();
                let task = tokio::spawn(async move {
                    run_socks_listener(task_handle, listener).await;
                });
                (handle, Some(task))
            }
            ForwardKind::Remote => {
                let target = Some((request.local_host.clone(), request.local_port));
                let handle =
                    Arc::new(open_connection(profile, target, self.host_keys.clone()).await?);
                handle
                    .tcpip_forward(request.remote_host.clone(), request.remote_port as u32)
                    .await
                    .map_err(ssh_error)?;
                (handle, None)
            }
        };

        self.forwards.lock().await.insert(
            id,
            ForwardEntry {
                info: info.clone(),
                _handle: handle,
                task,
            },
        );

        Ok(info)
    }

    pub async fn stop(&self, forward_id: &str) {
        if let Some(entry) = self.forwards.lock().await.remove(forward_id)
            && let Some(task) = entry.task
        {
            task.abort();
        }
    }

    pub async fn stop_session(&self, session_id: &str) {
        let mut forwards = self.forwards.lock().await;
        let ids: Vec<String> = forwards
            .iter()
            .filter(|(_, entry)| entry.info.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(entry) = forwards.remove(&id)
                && let Some(task) = entry.task
            {
                task.abort();
            }
        }
    }

    pub async fn list(&self, session_id: &str) -> Vec<PortForward> {
        self.forwards
            .lock()
            .await
            .values()
            .filter(|entry| entry.info.session_id == session_id)
            .map(|entry| entry.info.clone())
            .collect()
    }
}

async fn open_connection(
    profile: &SshProfile,
    remote_target: Option<(String, u16)>,
    verifier: Arc<HostKeyVerifier>,
) -> AppResult<client::Handle<ForwardHandler>> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(24 * 60 * 60)),
        ..<_>::default()
    });
    let handler = ForwardHandler {
        remote_target,
        verifier,
        host: profile.host.clone(),
        port: profile.port,
    };
    let mut handle = client::connect(config, (profile.host.as_str(), profile.port), handler)
        .await
        .map_err(ssh_error)?;
    authenticate(&mut handle, profile).await?;
    Ok(handle)
}

async fn bind_listener(host: &str, port: u16) -> AppResult<TcpListener> {
    TcpListener::bind((host, port)).await.map_err(|error| {
        AppError::new(
            "port_forward_bind_error",
            format!("无法绑定本地端口 {host}:{port}：{error}"),
        )
    })
}

/// Accept local connections and tunnel each one to `host:port` on the remote
/// side through a `direct-tcpip` channel.
async fn run_local_listener(
    handle: Arc<client::Handle<ForwardHandler>>,
    listener: TcpListener,
    host: String,
    port: u16,
) {
    loop {
        let (mut inbound, peer) = match listener.accept().await {
            Ok(value) => value,
            Err(_) => break,
        };
        let handle = handle.clone();
        let host = host.clone();
        tokio::spawn(async move {
            let channel = match handle
                .channel_open_direct_tcpip(
                    host,
                    port as u32,
                    peer.ip().to_string(),
                    peer.port() as u32,
                )
                .await
            {
                Ok(channel) => channel,
                Err(_) => return,
            };
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut inbound, &mut stream).await;
        });
    }
}

/// Relay a server-initiated (remote forward) channel to a local target.
async fn pipe_channel_to_local(
    channel: Channel<client::Msg>,
    host: String,
    port: u16,
) -> std::io::Result<()> {
    let mut outbound = TcpStream::connect((host.as_str(), port)).await?;
    let mut stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut outbound).await?;
    Ok(())
}

/// Minimal SOCKS5 (no-auth, CONNECT) proxy that tunnels each request through a
/// `direct-tcpip` channel on the SSH connection.
async fn run_socks_listener(handle: Arc<client::Handle<ForwardHandler>>, listener: TcpListener) {
    loop {
        let (inbound, _peer) = match listener.accept().await {
            Ok(value) => value,
            Err(_) => break,
        };
        let handle = handle.clone();
        tokio::spawn(async move {
            let _ = handle_socks_connection(handle, inbound).await;
        });
    }
}

async fn handle_socks_connection(
    handle: Arc<client::Handle<ForwardHandler>>,
    mut inbound: TcpStream,
) -> std::io::Result<()> {
    let mut greeting = [0_u8; 2];
    inbound.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Ok(());
    }
    let method_count = greeting[1] as usize;
    let mut methods = vec![0_u8; method_count];
    inbound.read_exact(&mut methods).await?;
    // Reply: version 5, no authentication required.
    inbound.write_all(&[0x05, 0x00]).await?;

    let mut request = [0_u8; 4];
    inbound.read_exact(&mut request).await?;
    if request[0] != 0x05 || request[1] != 0x01 {
        // Only the CONNECT command is supported.
        inbound
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Ok(());
    }

    let host = match request[3] {
        0x01 => {
            let mut addr = [0_u8; 4];
            inbound.read_exact(&mut addr).await?;
            Ipv4Addr::from(addr).to_string()
        }
        0x03 => {
            let mut length = [0_u8; 1];
            inbound.read_exact(&mut length).await?;
            let mut domain = vec![0_u8; length[0] as usize];
            inbound.read_exact(&mut domain).await?;
            String::from_utf8_lossy(&domain).to_string()
        }
        0x04 => {
            let mut addr = [0_u8; 16];
            inbound.read_exact(&mut addr).await?;
            Ipv6Addr::from(addr).to_string()
        }
        _ => {
            inbound
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Ok(());
        }
    };

    let mut port_bytes = [0_u8; 2];
    inbound.read_exact(&mut port_bytes).await?;
    let port = u16::from_be_bytes(port_bytes);

    let channel = match handle
        .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
        .await
    {
        Ok(channel) => channel,
        Err(_) => {
            // General SOCKS server failure.
            inbound
                .write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Ok(());
        }
    };

    // Success: bound address reported as 0.0.0.0:0.
    inbound
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;

    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut inbound, &mut stream).await;
    Ok(())
}

fn create_forward_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("forward-{seq}")
}
