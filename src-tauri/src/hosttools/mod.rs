//! Host tools: read-only system snapshots gathered by running a single
//! whitelisted command over SSH (via [`run_ssh_command`]) and parsing the
//! output into structured rows. Every parser is tolerant — on an unexpected
//! layout it simply yields fewer rows, and the raw text is always returned so
//! the UI can fall back to showing it verbatim.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    models::ssh_profile::SshProfile,
    ssh::{HostKeyVerifier, run_ssh_command},
};

/// Host-tools commands are quick; cap them well under the interactive timeout.
const TIMEOUT_SECS: u64 = 12;
const MAX_PROCESS_ROWS: usize = 20;
const MAX_LOG_LINES: usize = 200;

/// Which read-only snapshot to collect. Deserialized from the JS tool id.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostTool {
    Monitor,
    Processes,
    Services,
    Logs,
    Ports,
}

impl HostTool {
    fn id(self) -> &'static str {
        match self {
            HostTool::Monitor => "monitor",
            HostTool::Processes => "processes",
            HostTool::Services => "services",
            HostTool::Logs => "logs",
            HostTool::Ports => "ports",
        }
    }

    /// The single shell command whose stdout we parse. Each is read-only and
    /// falls back to alternatives (`||`) so it works across distros.
    fn command(self) -> &'static str {
        match self {
            HostTool::Monitor => {
                "echo '#HOST'; hostname 2>/dev/null; \
                 echo '#UP'; uptime 2>/dev/null; \
                 echo '#LOAD'; cat /proc/loadavg 2>/dev/null; \
                 echo '#CPU'; nproc 2>/dev/null; \
                 echo '#MEM'; free -m 2>/dev/null"
            }
            HostTool::Processes => {
                "ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -n 21"
            }
            HostTool::Services => {
                "systemctl list-units --type=service --no-pager --no-legend --plain 2>/dev/null | head -n 80"
            }
            HostTool::Logs => {
                "journalctl -n 150 --no-pager 2>/dev/null \
                 || tail -n 150 /var/log/syslog 2>/dev/null \
                 || tail -n 150 /var/log/messages 2>/dev/null"
            }
            HostTool::Ports => "ss -tulpnH 2>/dev/null || netstat -tulpn 2>/dev/null",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricItem {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub pid: String,
    pub user: String,
    pub cpu: String,
    pub mem: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRow {
    pub name: String,
    pub active: String,
    pub sub: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRow {
    pub proto: String,
    pub local: String,
    pub process: String,
}

/// A snapshot for one tool. Exactly one of the typed fields is populated
/// (matching `tool`); `raw` always holds the command output for fallback.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostToolsSnapshot {
    pub tool: String,
    pub raw: String,
    pub error: Option<String>,
    pub monitor: Option<Vec<MetricItem>>,
    pub processes: Option<Vec<ProcessRow>>,
    pub services: Option<Vec<ServiceRow>>,
    pub logs: Option<Vec<String>>,
    pub ports: Option<Vec<PortRow>>,
}

/// Run the tool's command over a fresh SSH connection and parse the result.
pub async fn snapshot(
    profile: SshProfile,
    tool: HostTool,
    verifier: Arc<HostKeyVerifier>,
) -> AppResult<HostToolsSnapshot> {
    let output =
        run_ssh_command(profile, tool.command().to_string(), TIMEOUT_SECS, verifier).await?;
    let stdout = output.stdout;
    let raw = if stdout.trim().is_empty() && !output.stderr.trim().is_empty() {
        output.stderr.clone()
    } else {
        stdout.clone()
    };

    let mut snapshot = HostToolsSnapshot {
        tool: tool.id().to_string(),
        raw,
        ..Default::default()
    };
    if output.timed_out {
        snapshot.error = Some("命令执行超时，数据可能不完整。".to_string());
    }

    match tool {
        HostTool::Monitor => snapshot.monitor = Some(parse_monitor(&stdout)),
        HostTool::Processes => snapshot.processes = Some(parse_processes(&stdout)),
        HostTool::Services => {
            let rows = parse_services(&stdout);
            if rows.is_empty() && snapshot.error.is_none() {
                snapshot.error = Some("未获取到服务列表（该主机可能没有 systemctl）。".to_string());
            }
            snapshot.services = Some(rows);
        }
        HostTool::Logs => snapshot.logs = Some(parse_logs(&stdout)),
        HostTool::Ports => snapshot.ports = Some(parse_ports(&stdout)),
    }

    Ok(snapshot)
}

/// Split the monitor probe into its `#MARKER` sections.
fn monitor_section<'a>(out: &'a str, marker: &str) -> Vec<&'a str> {
    let mut collecting = false;
    let mut lines = Vec::new();
    for line in out.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix('#') {
            collecting = name == marker;
            continue;
        }
        if collecting && !trimmed.is_empty() {
            lines.push(trimmed);
        }
    }
    lines
}

fn parse_monitor(out: &str) -> Vec<MetricItem> {
    let mut items = Vec::new();

    if let Some(host) = monitor_section(out, "HOST").first() {
        items.push(MetricItem {
            label: "主机名".to_string(),
            value: host.to_string(),
        });
    }

    if let Some(up) = monitor_section(out, "UP").first()
        && let Some(uptime) = extract_uptime(up)
    {
        items.push(MetricItem {
            label: "运行时间".to_string(),
            value: uptime,
        });
    }

    if let Some(load) = monitor_section(out, "LOAD").first() {
        let parts: Vec<&str> = load.split_whitespace().collect();
        if parts.len() >= 3 {
            items.push(MetricItem {
                label: "负载 (1/5/15m)".to_string(),
                value: format!("{} · {} · {}", parts[0], parts[1], parts[2]),
            });
        }
    }

    if let Some(cpu) = monitor_section(out, "CPU").first() {
        items.push(MetricItem {
            label: "CPU 核心".to_string(),
            value: cpu.to_string(),
        });
    }

    for line in monitor_section(out, "MEM") {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if let Some(first) = parts.first() {
            if first.starts_with("Mem") && parts.len() >= 3 {
                items.push(MetricItem {
                    label: "内存".to_string(),
                    value: format!("{} / {} MB", parts[2], parts[1]),
                });
            } else if first.starts_with("Swap") && parts.len() >= 3 {
                items.push(MetricItem {
                    label: "交换".to_string(),
                    value: format!("{} / {} MB", parts[2], parts[1]),
                });
            }
        }
    }

    items
}

/// Pull the "up 3 days, 2:11" clause out of an `uptime` line.
fn extract_uptime(line: &str) -> Option<String> {
    let idx = line.find(" up ")?;
    let rest = &line[idx + 4..];
    let end = match rest.find(" user") {
        Some(user_idx) => rest[..user_idx].rfind(',').unwrap_or(user_idx),
        None => rest.find("load average").unwrap_or(rest.len()),
    };
    let value = rest[..end].trim().trim_end_matches(',').trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn parse_processes(out: &str) -> Vec<ProcessRow> {
    out.lines()
        .skip(1) // header row
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                return None;
            }
            Some(ProcessRow {
                pid: parts[0].to_string(),
                user: parts[1].to_string(),
                cpu: parts[2].to_string(),
                mem: parts[3].to_string(),
                command: parts[4..].join(" "),
            })
        })
        .take(MAX_PROCESS_ROWS)
        .collect()
}

fn parse_services(out: &str) -> Vec<ServiceRow> {
    out.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                return None;
            }
            Some(ServiceRow {
                name: parts[0].to_string(),
                active: parts[2].to_string(),
                sub: parts[3].to_string(),
                description: parts
                    .get(4..)
                    .map(|rest| rest.join(" "))
                    .unwrap_or_default(),
            })
        })
        .collect()
}

fn parse_logs(out: &str) -> Vec<String> {
    out.lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .rev()
        .take(MAX_LOG_LINES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn parse_ports(out: &str) -> Vec<PortRow> {
    out.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let lower = trimmed.to_lowercase();
            if !(lower.starts_with("tcp") || lower.starts_with("udp")) {
                return None;
            }
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            let proto = parts.first().copied().unwrap_or("").to_string();
            // The local address is the first `host:port` token; the peer (second
            // such token) is ignored. Works for both `ss` and `netstat` layouts.
            let local = parts
                .iter()
                .find(|token| token.contains(':'))
                .copied()
                .unwrap_or("")
                .to_string();
            let process = parts
                .iter()
                .find(|token| token.contains("users:(("))
                .map(|token| extract_ss_process(token))
                .or_else(|| {
                    parts
                        .iter()
                        .rev()
                        .find(|token| token.contains('/'))
                        .map(|token| token.to_string())
                })
                .unwrap_or_default();
            Some(PortRow {
                proto,
                local,
                process,
            })
        })
        .collect()
}

/// Extract the program name from an `ss` process token like
/// `users:(("sshd",pid=1,fd=3))` → `sshd`.
fn extract_ss_process(token: &str) -> String {
    if let Some(start) = token.find('"')
        && let Some(end) = token[start + 1..].find('"')
    {
        return token[start + 1..start + 1 + end].to_string();
    }
    token.to_string()
}
