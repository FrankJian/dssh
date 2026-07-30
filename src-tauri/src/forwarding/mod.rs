use std::{
    collections::HashMap,
    net::{Ipv4Addr, Ipv6Addr},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

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
    ssh::{ChannelOwner, ConnectionLease, SshConnectionPool},
};

struct ForwardEntry {
    info: PortForward,
    // A forward keeps one shared transport lease alive. It never owns the
    // transport itself, so stopping one forward cannot drop sibling channels.
    _transport: ForwardTransport,
    // Accept loop for local/dynamic forwards. Remote forwards use the pooled
    // client handler's callback route and therefore need no listener task.
    task: Option<JoinHandle<()>>,
}

enum ForwardTransport {
    Pooled {
        _lease: Arc<ConnectionLease>,
    },
    Remote {
        lease: Arc<ConnectionLease>,
        bind_host: String,
        port: u32,
    },
}

#[derive(Clone)]
pub struct ForwardManager {
    forwards: Arc<Mutex<HashMap<String, ForwardEntry>>>,
    pool: SshConnectionPool,
}

impl ForwardManager {
    pub fn new(pool: SshConnectionPool) -> Self {
        Self {
            forwards: Arc::new(Mutex::new(HashMap::new())),
            pool,
        }
    }

    pub async fn start(
        &self,
        profile: &SshProfile,
        request: StartPortForwardRequest,
    ) -> AppResult<PortForward> {
        let id = create_forward_id();

        let mut info = PortForward {
            id: id.clone(),
            session_id: request.session_id.clone(),
            kind: request.kind,
            local_host: request.local_host.clone(),
            local_port: request.local_port,
            remote_host: request.remote_host.clone(),
            remote_port: request.remote_port,
            description: request.description.clone(),
        };

        let (transport, task) = match request.kind {
            ForwardKind::Local => {
                let listener = bind_listener(&request.local_host, request.local_port).await?;
                let lease = Arc::new(
                    self.pool
                        .acquire(profile.clone(), ChannelOwner::Forward)
                        .await?,
                );
                let task_lease = lease.clone();
                let remote_host = request.remote_host.clone();
                let remote_port = request.remote_port;
                let task = tokio::spawn(async move {
                    run_local_listener(task_lease, listener, remote_host, remote_port).await;
                });
                (ForwardTransport::Pooled { _lease: lease }, Some(task))
            }
            ForwardKind::Dynamic => {
                let listener = bind_listener(&request.local_host, request.local_port).await?;
                let lease = Arc::new(
                    self.pool
                        .acquire(profile.clone(), ChannelOwner::Forward)
                        .await?,
                );
                let task_lease = lease.clone();
                let task = tokio::spawn(async move {
                    run_socks_listener(task_lease, listener).await;
                });
                (ForwardTransport::Pooled { _lease: lease }, Some(task))
            }
            ForwardKind::Remote => {
                let lease = Arc::new(
                    self.pool
                        .acquire(profile.clone(), ChannelOwner::Forward)
                        .await?,
                );
                let assigned_port = lease
                    .start_remote_forward(
                        request.remote_host.clone(),
                        request.remote_port as u32,
                        request.local_host.clone(),
                        request.local_port,
                    )
                    .await?;
                info.remote_port = u16::try_from(assigned_port).map_err(|_| {
                    AppError::new("port_forward_error", "远程服务器分配的端口无效。")
                })?;
                (
                    ForwardTransport::Remote {
                        lease,
                        bind_host: request.remote_host.clone(),
                        port: assigned_port,
                    },
                    None,
                )
            }
        };

        self.forwards.lock().await.insert(
            id,
            ForwardEntry {
                info: info.clone(),
                _transport: transport,
                task,
            },
        );

        Ok(info)
    }

    pub async fn stop(&self, forward_id: &str) {
        if let Some(entry) = self.forwards.lock().await.remove(forward_id) {
            stop_entry(entry).await;
        }
    }

    pub async fn stop_session(&self, session_id: &str) {
        let mut forwards = self.forwards.lock().await;
        let ids = forwards
            .iter()
            .filter(|(_, entry)| entry.info.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let entries = ids
            .into_iter()
            .filter_map(|id| forwards.remove(&id))
            .collect::<Vec<_>>();
        drop(forwards);
        for entry in entries {
            stop_entry(entry).await;
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

async fn stop_entry(entry: ForwardEntry) {
    let ForwardEntry {
        _transport, task, ..
    } = entry;
    if let ForwardTransport::Remote {
        lease,
        bind_host,
        port,
    } = _transport
    {
        let _ = lease.stop_remote_forward(bind_host, port).await;
    }
    if let Some(task) = task {
        task.abort();
    }
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
    lease: Arc<ConnectionLease>,
    listener: TcpListener,
    host: String,
    port: u16,
) {
    loop {
        let (mut inbound, peer) = match listener.accept().await {
            Ok(value) => value,
            Err(_) => break,
        };
        let lease = lease.clone();
        let host = host.clone();
        tokio::spawn(async move {
            let (channel, _channel_lease) = match lease
                .open_direct_tcpip_channel(
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

/// Minimal SOCKS5 (no-auth, CONNECT) proxy that tunnels each request through a
/// `direct-tcpip` channel on the SSH connection.
async fn run_socks_listener(lease: Arc<ConnectionLease>, listener: TcpListener) {
    loop {
        let (inbound, _peer) = match listener.accept().await {
            Ok(value) => value,
            Err(_) => break,
        };
        let lease = lease.clone();
        tokio::spawn(async move {
            let _ = handle_socks_connection(lease, inbound).await;
        });
    }
}

async fn handle_socks_connection(
    lease: Arc<ConnectionLease>,
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

    let (channel, _channel_lease) = match lease
        .open_direct_tcpip_channel(host, port as u32, "127.0.0.1".to_string(), 0)
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
