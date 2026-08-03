//! Kubernetes Phase 0 foundations.
//!
//! This module only discovers non-secret kubeconfig metadata and remote
//! kubectl capabilities. It intentionally does not persist kubeconfig content
//! or execute resource-changing Kubernetes operations.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};

use futures::{AsyncBufReadExt, StreamExt};
use kube::{
    Client,
    api::{Api, DynamicObject, ListParams, LogParams, PostParams},
    config::{KubeConfigOptions, Kubeconfig},
    core::{ApiResource, GroupVersionKind},
    discovery::{Discovery, Scope, verbs},
};
use russh::ChannelMsg;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex as AsyncMutex, watch};

use crate::{
    error::{AppError, AppResult},
    models::{
        kubernetes::{
            KubernetesCapabilities, KubernetesCapabilityRequest, KubernetesContextSelection,
            KubernetesContextSummary, KubernetesLabel, KubernetesPodLogEvent, KubernetesPodLogs,
            KubernetesPodLogsRequest, KubernetesProfile, KubernetesResourceDocument,
            KubernetesResourceDocumentRequest, KubernetesResourceItem, KubernetesResourceList,
            KubernetesResourceQuery, KubernetesSource, LocalKubeconfigScanRequest,
            LocalKubeconfigScanResult, RemoteKubeconfigCandidate, RemoteKubernetesDiscoveryRequest,
            RemoteKubernetesDiscoveryResult,
        },
        ssh_profile::SshProfile,
    },
    ssh::{ChannelOwner, CommandOutput, SshConnectionPool, run_ssh_command_with_limit},
};

const DISCOVERY_TIMEOUT_SECS: u64 = 12;
const DISCOVERY_MAX_OUTPUT_BYTES: usize = 128 * 1024;
const VERSION_MAX_OUTPUT_BYTES: usize = 16 * 1024;
const MAX_REMOTE_VALUE_LEN: usize = 4096;
const RESOURCE_MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const LOG_MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub const POD_LOG_EVENT: &str = "kubernetes://pod-log";
static NEXT_LOG_OPERATION_ID: AtomicU64 = AtomicU64::new(1);
const RESOURCE_TIMEOUT_SECS: u64 = 20;
const REMOTE_CANDIDATE_PATHS_COMMAND: &str = r#"
if [ -n "${KUBECONFIG:-}" ]; then
  printf '%s' "$KUBECONFIG" | tr ':' '\n'
fi
for dssh_kubeconfig_candidate in "$HOME/.kube/config" /etc/kubernetes/admin.conf /etc/rancher/k3s/k3s.yaml /etc/rancher/rke2/rke2.yaml; do
  if [ -r "$dssh_kubeconfig_candidate" ]; then
    printf '%s\n' "$dssh_kubeconfig_candidate"
  fi
done
"#;
const CONTEXT_JSONPATH: &str = r#"{range .contexts[*]}{.name}{"\t"}{.context.cluster}{"\t"}{.context.user}{"\t"}{.context.namespace}{"\n"}{end}"#;

/// Caches local API clients by kubeconfig fingerprint and context. A changed
/// file produces a new key; the old client is harmless and short lived with
/// the process. Credential refresh remains owned by the kube client.
#[derive(Clone)]
pub struct KubernetesManager {
    clients: Arc<Mutex<HashMap<String, Client>>>,
    log_operations: Arc<AsyncMutex<HashMap<String, watch::Sender<bool>>>>,
}

impl Default for KubernetesManager {
    fn default() -> Self {
        Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
            log_operations: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }
}

impl KubernetesManager {
    async fn local_client(
        &self,
        kubeconfig_paths: &[String],
        context: &KubernetesContextSelection,
    ) -> AppResult<Client> {
        let source_path = expand_local_path(&context.source_id);
        let allowed_paths = resolve_local_kubeconfig_paths(kubeconfig_paths)?;
        if !allowed_paths.iter().any(|path| path == &source_path) {
            return Err(AppError::new(
                "kubernetes_context_source_missing",
                "所选 Kubernetes context 不属于当前配置来源。请重新扫描配置。",
            ));
        }
        let fingerprint = local_client_fingerprint(&source_path, context)?;
        if let Some(client) = self
            .clients
            .lock()
            .expect("kubernetes client cache lock")
            .get(&fingerprint)
            .cloned()
        {
            return Ok(client);
        }
        let kubeconfig = Kubeconfig::read_from(&source_path).map_err(|error| {
            AppError::new(
                "kubeconfig_read_error",
                format!("无法读取 kubeconfig '{}': {error}", source_path.display()),
            )
        })?;
        let config = kube::Config::from_custom_kubeconfig(
            kubeconfig,
            &KubeConfigOptions {
                context: Some(context.name.clone()),
                ..Default::default()
            },
        )
        .await
        .map_err(|error| {
            AppError::new(
                "kubernetes_config_error",
                format!("无法加载 context：{error}"),
            )
        })?;
        let client = Client::try_from(config).map_err(|error| {
            AppError::new(
                "kubernetes_client_error",
                format!("无法创建 Kubernetes 客户端：{error}"),
            )
        })?;
        self.clients
            .lock()
            .expect("kubernetes client cache lock")
            .insert(fingerprint, client.clone());
        Ok(client)
    }

    pub fn clear_local_clients(&self) {
        self.clients
            .lock()
            .expect("kubernetes client cache lock")
            .clear();
    }
}

fn local_client_fingerprint(
    path: &PathBuf,
    context: &KubernetesContextSelection,
) -> AppResult<String> {
    let modified = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(format!(
        "{}\u{0}{}\u{0}{modified}",
        path.to_string_lossy(),
        context.name
    ))
}

/// Scan selected local config paths, or the standard local kubeconfig
/// locations when no explicit path was supplied. Only context metadata crosses
/// the Tauri boundary.
pub fn scan_local_kubeconfig(
    request: LocalKubeconfigScanRequest,
) -> AppResult<LocalKubeconfigScanResult> {
    let source_paths = resolve_local_kubeconfig_paths(&request.paths)?;
    let mut current_context = None;
    let mut contexts = Vec::new();
    let mut seen_context_names = HashSet::new();

    for path in &source_paths {
        let config = Kubeconfig::read_from(path).map_err(|error| {
            AppError::new(
                "kubeconfig_read_error",
                format!("无法读取 kubeconfig '{}': {error}", path.display()),
            )
        })?;
        if current_context.is_none() {
            current_context = config.current_context.clone();
        }

        for context in context_summaries(&config, &path.to_string_lossy()) {
            if seen_context_names.insert(context.name.clone()) {
                contexts.push(context);
            }
        }
    }

    for context in &mut contexts {
        context.is_current = current_context.as_deref() == Some(context.name.as_str());
    }

    Ok(LocalKubeconfigScanResult {
        source_paths: source_paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        contexts,
        current_context,
    })
}

/// Discover kubectl and readable kubeconfig files on an existing SSH host.
/// Dynamic values are quoted in Rust and callers cannot pass a shell command.
pub async fn discover_remote_kubernetes(
    profile: SshProfile,
    request: RemoteKubernetesDiscoveryRequest,
    pool: &SshConnectionPool,
) -> AppResult<RemoteKubernetesDiscoveryResult> {
    let mut warnings = Vec::new();
    let kubectl_path = match request
        .kubectl_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        Some(path) => {
            validate_remote_value(path, "kubectl 路径")?;
            Some(path.trim().to_string())
        }
        None => discover_remote_kubectl_path(&profile, pool).await?,
    };

    let Some(kubectl_path) = kubectl_path else {
        return Ok(RemoteKubernetesDiscoveryResult {
            kubectl_path: None,
            kubectl_version: None,
            candidates: Vec::new(),
            warnings: vec!["远端未发现 kubectl；可手工填写 kubectl 路径后重新扫描。".to_string()],
        });
    };

    let kubectl_version = discover_remote_kubectl_version(&profile, &kubectl_path, pool).await?;
    if kubectl_version.is_none() {
        warnings.push("已找到 kubectl，但无法读取客户端版本。".to_string());
    }

    let paths = match request
        .kubeconfig_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
    {
        Some(path) => {
            validate_remote_value(path, "远端 kubeconfig 路径")?;
            vec![path.trim().to_string()]
        }
        None => discover_remote_kubeconfig_paths(&profile, pool).await?,
    };

    if paths.is_empty() {
        warnings
            .push("未在远端默认位置发现可读 kubeconfig；可手工填写路径后重新扫描。".to_string());
    }

    let mut candidates = Vec::with_capacity(paths.len());
    for path in paths {
        candidates.push(discover_remote_candidate(&profile, &kubectl_path, &path, pool).await);
    }

    Ok(RemoteKubernetesDiscoveryResult {
        kubectl_path: Some(kubectl_path),
        kubectl_version,
        candidates,
        warnings,
    })
}

/// Lists an allowlisted set of Kubernetes resources without exposing raw
/// kubeconfig content. Secret bodies are redacted before crossing Tauri.
pub async fn list_resources(
    profile: KubernetesProfile,
    query: KubernetesResourceQuery,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesResourceList> {
    validate_resource_query(&query)?;
    let value = match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => {
            local_list_resources(kubeconfig_paths, &query, manager).await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let ssh_profile = ssh_profiles.get_profile(ssh_profile_id)?.ok_or_else(|| {
                AppError::new(
                    "kubernetes_source_unavailable",
                    "Kubernetes 来源所选的 SSH 连接已不存在。",
                )
            })?;
            remote_list_resources(
                &ssh_profile,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                &query,
                pool,
            )
            .await?
        }
    };
    resource_list_from_value(value, &query)
}

/// Gets one allowlisted resource document. Secrets are reduced to metadata,
/// type and key names; their values never reach the frontend.
pub async fn get_resource_document(
    profile: KubernetesProfile,
    request: KubernetesResourceDocumentRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesResourceDocument> {
    validate_resource_document_request(&request)?;
    let value = match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => {
            local_get_resource(kubeconfig_paths, &request, manager).await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let ssh_profile = ssh_profiles.get_profile(ssh_profile_id)?.ok_or_else(|| {
                AppError::new(
                    "kubernetes_source_unavailable",
                    "Kubernetes 来源所选的 SSH 连接已不存在。",
                )
            })?;
            remote_get_resource(
                &ssh_profile,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                &request,
                pool,
            )
            .await?
        }
    };
    resource_document_from_value(value)
}

/// Reads a bounded Pod log snapshot.  This deliberately does not use
/// `follow`: a long-lived follow stream needs an operation owner and cancel
/// path, while this API is safe to use for an on-demand log viewer and refresh.
pub async fn pod_logs(
    profile: KubernetesProfile,
    request: KubernetesPodLogsRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesPodLogs> {
    validate_pod_logs_request(&request)?;
    let content = match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => {
            let client = manager
                .local_client(kubeconfig_paths, &request.context)
                .await?;
            let namespace = request.namespace.as_deref().unwrap_or("default");
            let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, namespace);
            let params = pod_log_params(&request);
            api.logs(&request.pod, &params).await.map_err(|error| {
                AppError::new(
                    "kubernetes_logs_failed",
                    format!("读取 Pod 日志失败：{error}"),
                )
            })?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let ssh_profile = ssh_profiles.get_profile(ssh_profile_id)?.ok_or_else(|| {
                AppError::new(
                    "kubernetes_source_unavailable",
                    "Kubernetes 来源所选的 SSH 连接已不存在。",
                )
            })?;
            let command = remote_logs_command(
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                &request,
            )?;
            let output = run_ssh_command_with_limit(
                ssh_profile,
                command,
                RESOURCE_TIMEOUT_SECS,
                LOG_MAX_OUTPUT_BYTES,
                pool,
            )
            .await?;
            if output.timed_out {
                return Err(AppError::new(
                    "remote_kubernetes_logs_timeout",
                    "远端 Pod 日志读取超时。",
                ));
            }
            if output.exit_code != Some(0) {
                return Err(AppError::new(
                    "remote_kubernetes_logs_failed",
                    command_failure_message(&output, "远端 Pod 日志读取失败"),
                ));
            }
            output.stdout
        }
    };
    let (content, truncated) = truncate_log(content);
    Ok(KubernetesPodLogs { content, truncated })
}

/// Starts one owned log-follow operation. Chunks are emitted on
/// `kubernetes://pod-log`; cancelling only closes this API/SSH channel and
/// never tears down the shared transport or other terminal sessions.
pub async fn start_pod_log_follow(
    app_handle: AppHandle,
    profile: KubernetesProfile,
    request: KubernetesPodLogsRequest,
    manager: KubernetesManager,
    ssh_profiles: crate::storage::ProfileRepository,
    pool: SshConnectionPool,
) -> AppResult<String> {
    validate_pod_logs_request(&request)?;
    let operation_id = request
        .operation_id
        .clone()
        .filter(|value| is_valid_operation_id(value))
        .unwrap_or_else(|| {
            format!(
                "kube-log-{}",
                NEXT_LOG_OPERATION_ID.fetch_add(1, Ordering::Relaxed)
            )
        });
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    manager
        .log_operations
        .lock()
        .await
        .insert(operation_id.clone(), cancel_sender);

    let task_operation_id = operation_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = match &profile.source {
            KubernetesSource::Local { kubeconfig_paths } => {
                follow_local_pod_logs(
                    &app_handle,
                    &task_operation_id,
                    kubeconfig_paths,
                    &request,
                    &manager,
                    cancel_receiver,
                )
                .await
            }
            KubernetesSource::RemoteSsh {
                ssh_profile_id,
                kubeconfig_path,
                kubectl_path,
            } => {
                let ssh_profile = ssh_profiles
                    .get_profile(ssh_profile_id)
                    .and_then(|profile| {
                        profile.ok_or_else(|| {
                            AppError::new(
                                "kubernetes_source_unavailable",
                                "Kubernetes 来源所选的 SSH 连接已不存在。",
                            )
                        })
                    });
                match ssh_profile {
                    Ok(ssh_profile) => {
                        follow_remote_pod_logs(RemotePodLogFollowInput {
                            app_handle: &app_handle,
                            operation_id: &task_operation_id,
                            profile: &ssh_profile,
                            kubeconfig_path: kubeconfig_path.as_deref(),
                            kubectl_path: kubectl_path.as_deref(),
                            request: &request,
                            pool: &pool,
                            cancelled: cancel_receiver,
                        })
                        .await
                    }
                    Err(error) => Err(error),
                }
            }
        };
        if let Err(error) = result {
            emit_pod_log_event(
                &app_handle,
                &task_operation_id,
                "error",
                None,
                Some(error.message),
            );
        }
        manager
            .log_operations
            .lock()
            .await
            .remove(&task_operation_id);
    });
    Ok(operation_id)
}

pub async fn cancel_pod_log_follow(manager: &KubernetesManager, operation_id: &str) {
    if let Some(sender) = manager.log_operations.lock().await.remove(operation_id) {
        let _ = sender.send(true);
    }
}

/// Builds the first command for a Kubernetes CLI terminal.  It only returns
/// carefully quoted, non-secret configuration references; the terminal is
/// still created through the normal local/SSH session lifecycle.
pub async fn cli_launch(
    profile: &KubernetesProfile,
    context: &KubernetesContextSelection,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<crate::models::kubernetes::KubernetesCliLaunch> {
    validate_resource_context(context)?;
    let (command, ssh_profile_id, source_label, kubectl_version, warning) = match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => {
            let kubectl_version = local_kubectl_version().await;
            let warning = kubectl_version.is_none().then(|| {
                "未能在应用环境中验证本机 kubectl；终端仍会尝试按当前 PATH 执行。".to_string()
            });
            (
                local_cli_command(kubeconfig_paths, context)?,
                None,
                "本机 Kubernetes CLI".to_string(),
                kubectl_version,
                warning,
            )
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let kubectl_version =
                ssh_profiles
                    .get_profile(ssh_profile_id)?
                    .map(|ssh_profile| async move {
                        discover_remote_kubectl_version(
                            &ssh_profile,
                            kubectl_path.as_deref().unwrap_or("kubectl"),
                            pool,
                        )
                        .await
                        .ok()
                        .flatten()
                    });
            let kubectl_version = match kubectl_version {
                Some(future) => future.await,
                None => None,
            };
            let warning = kubectl_version
                .is_none()
                .then(|| "未能在远端验证 kubectl；终端仍会尝试使用所选路径执行。".to_string());
            (
                remote_cli_command(kubeconfig_path.as_deref(), kubectl_path.as_deref(), context)?,
                Some(ssh_profile_id.clone()),
                "远端 Kubernetes CLI".to_string(),
                kubectl_version,
                warning,
            )
        }
    };
    Ok(crate::models::kubernetes::KubernetesCliLaunch {
        command,
        ssh_profile_id,
        source_label,
        kubectl_version,
        warning,
    })
}

/// Discovers API resources (including CRDs) and performs a small, read-only
/// permission probe for the workspace. It never requests secret values.
pub async fn capabilities(
    profile: KubernetesProfile,
    request: KubernetesCapabilityRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesCapabilities> {
    validate_resource_context(&request.context)?;
    match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => {
            let client = manager
                .local_client(kubeconfig_paths, &request.context)
                .await?;
            local_capabilities(client).await
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let ssh_profile = ssh_profiles.get_profile(ssh_profile_id)?.ok_or_else(|| {
                AppError::new(
                    "kubernetes_source_unavailable",
                    "Kubernetes 来源所选的 SSH 连接已不存在。",
                )
            })?;
            remote_capabilities(
                &ssh_profile,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                &request.context,
                pool,
            )
            .await
        }
    }
}

async fn local_capabilities(client: Client) -> AppResult<KubernetesCapabilities> {
    let discovery = Discovery::new(client.clone())
        .run()
        .await
        .map_err(|error| {
            AppError::new(
                "kubernetes_discovery_failed",
                format!("Kubernetes API Discovery 失败：{error}"),
            )
        })?;
    let mut resources = Vec::new();
    for group in discovery.groups() {
        for (resource, capabilities) in group.recommended_resources() {
            if !capabilities.supports_operation(verbs::LIST) {
                continue;
            }
            resources.push(crate::models::kubernetes::KubernetesResourceType {
                name: resource.plural,
                api_version: resource.api_version,
                kind: resource.kind,
                namespaced: capabilities.scope == Scope::Namespaced,
                verbs: capabilities.operations,
            });
        }
    }
    resources.sort_by(|left, right| left.kind.cmp(&right.kind));
    let username = local_self_subject_username(client.clone()).await;
    let can_list_pods = local_can_i(client.clone(), "list").await;
    let can_get_pods = local_can_i(client.clone(), "get").await;
    let can_create_pods = local_can_i(client, "create").await;
    Ok(KubernetesCapabilities {
        resources,
        can_list_pods,
        can_get_pods,
        can_create_pods,
        source: "localApi".to_string(),
        username,
    })
}

async fn local_can_i(client: Client, verb: &str) -> Option<bool> {
    let ar = ApiResource::from_gvk_with_plural(
        &GroupVersionKind::gvk("authorization.k8s.io", "v1", "SelfSubjectAccessReview"),
        "selfsubjectaccessreviews",
    );
    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let body = DynamicObject::new("", &ar).data(serde_json::json!({ "spec": { "resourceAttributes": { "verb": verb, "resource": "pods" } } }));
    api.create(&PostParams::default(), &body)
        .await
        .ok()?
        .data
        .pointer("/status/allowed")
        .and_then(serde_json::Value::as_bool)
}

async fn local_self_subject_username(client: Client) -> Option<String> {
    let ar = ApiResource::from_gvk_with_plural(
        &GroupVersionKind::gvk("authentication.k8s.io", "v1", "SelfSubjectReview"),
        "selfsubjectreviews",
    );
    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let body = DynamicObject::new("", &ar).data(serde_json::json!({ "spec": {} }));
    api.create(&PostParams::default(), &body)
        .await
        .ok()?
        .data
        .pointer("/status/userInfo/username")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

async fn remote_capabilities(
    profile: &SshProfile,
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    context: &KubernetesContextSelection,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesCapabilities> {
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut base = format!("{executable} --context {}", shell_quote(&context.name)?);
    if let Some(path) = kubeconfig_path.filter(|path| !path.trim().is_empty()) {
        base.push_str(&format!(" --kubeconfig {}", shell_quote(path)?));
    }
    let resources_output = run_ssh_command_with_limit(
        profile.clone(),
        format!("{base} api-resources --verbs=list --output=name"),
        RESOURCE_TIMEOUT_SECS,
        RESOURCE_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    let resources = if resources_output.exit_code == Some(0) && !resources_output.output_truncated {
        resources_output
            .stdout
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect()
    } else {
        Vec::new()
    };
    let username_output = run_ssh_command_with_limit(
        profile.clone(),
        format!("{base} auth whoami --output=json"),
        RESOURCE_TIMEOUT_SECS,
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await
    .ok();
    let username = username_output
        .and_then(|output| serde_json::from_str::<serde_json::Value>(&output.stdout).ok())
        .and_then(|value| {
            value
                .get("username")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });
    let can_list_pods = remote_can_i(profile, &base, "list", pool).await;
    let can_get_pods = remote_can_i(profile, &base, "get", pool).await;
    let can_create_pods = remote_can_i(profile, &base, "create", pool).await;
    Ok(KubernetesCapabilities {
        resources: resources
            .into_iter()
            .map(|name| crate::models::kubernetes::KubernetesResourceType {
                kind: name.clone(),
                name,
                api_version: String::new(),
                namespaced: true,
                verbs: vec!["list".to_string()],
            })
            .collect(),
        can_list_pods,
        can_get_pods,
        can_create_pods,
        source: "remoteKubectl".to_string(),
        username,
    })
}

async fn remote_can_i(
    profile: &SshProfile,
    base: &str,
    verb: &str,
    pool: &SshConnectionPool,
) -> Option<bool> {
    let output = run_ssh_command_with_limit(
        profile.clone(),
        format!("{base} auth can-i {verb} pods --output=json"),
        RESOURCE_TIMEOUT_SECS,
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await
    .ok()?;
    if output.exit_code != Some(0) || output.output_truncated {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(&output.stdout)
        .ok()?
        .as_bool()
}

async fn local_list_resources(
    kubeconfig_paths: &[String],
    query: &KubernetesResourceQuery,
    manager: &KubernetesManager,
) -> AppResult<serde_json::Value> {
    let client = manager
        .local_client(kubeconfig_paths, &query.context)
        .await?;
    let api = dynamic_api(client, query, query.namespace.as_deref())?;
    let params = list_params(query)?;
    let list = api.list(&params).await.map_err(|error| {
        AppError::new(
            "kubernetes_list_failed",
            format!("读取 Kubernetes 资源失败：{error}"),
        )
    })?;
    serde_json::to_value(list)
        .map_err(|error| AppError::new("kubernetes_serialization_error", error.to_string()))
}

async fn local_get_resource(
    kubeconfig_paths: &[String],
    request: &KubernetesResourceDocumentRequest,
    manager: &KubernetesManager,
) -> AppResult<serde_json::Value> {
    let client = manager
        .local_client(kubeconfig_paths, &request.context)
        .await?;
    let query = KubernetesResourceQuery {
        profile_id: request.profile_id.clone(),
        context: request.context.clone(),
        resource: request.resource.clone(),
        api_version: request.api_version.clone(),
        kind: request.kind.clone(),
        namespaced: request.namespaced,
        namespace: request.namespace.clone(),
        label_selector: None,
        limit: 1,
        continue_token: None,
    };
    let api = dynamic_api(client, &query, request.namespace.as_deref())?;
    let object = api.get(&request.name).await.map_err(|error| {
        AppError::new(
            "kubernetes_get_failed",
            format!("读取 Kubernetes 资源失败：{error}"),
        )
    })?;
    serde_json::to_value(object)
        .map_err(|error| AppError::new("kubernetes_serialization_error", error.to_string()))
}

fn dynamic_api(
    client: Client,
    query: &KubernetesResourceQuery,
    namespace: Option<&str>,
) -> AppResult<Api<DynamicObject>> {
    let descriptor = resource_descriptor(query)?;
    Ok(match (descriptor.namespaced, namespace) {
        (true, Some(namespace)) => {
            Api::namespaced_with(client, namespace, &descriptor.api_resource)
        }
        (true, None) => Api::all_with(client, &descriptor.api_resource),
        (false, _) => Api::all_with(client, &descriptor.api_resource),
    })
}

async fn remote_list_resources(
    profile: &SshProfile,
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    query: &KubernetesResourceQuery,
    pool: &SshConnectionPool,
) -> AppResult<serde_json::Value> {
    let command = remote_kubectl_command(kubeconfig_path, kubectl_path, query, None)?;
    remote_json(profile, &command, pool).await
}

async fn remote_get_resource(
    profile: &SshProfile,
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesResourceDocumentRequest,
    pool: &SshConnectionPool,
) -> AppResult<serde_json::Value> {
    let query = KubernetesResourceQuery {
        profile_id: request.profile_id.clone(),
        context: request.context.clone(),
        resource: request.resource.clone(),
        api_version: request.api_version.clone(),
        kind: request.kind.clone(),
        namespaced: request.namespaced,
        namespace: request.namespace.clone(),
        label_selector: None,
        limit: 1,
        continue_token: None,
    };
    let command =
        remote_kubectl_command(kubeconfig_path, kubectl_path, &query, Some(&request.name))?;
    remote_json(profile, &command, pool).await
}

async fn remote_json(
    profile: &SshProfile,
    command: &str,
    pool: &SshConnectionPool,
) -> AppResult<serde_json::Value> {
    let output = run_ssh_command_with_limit(
        profile.clone(),
        command.to_string(),
        RESOURCE_TIMEOUT_SECS,
        RESOURCE_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if output.timed_out {
        return Err(AppError::new(
            "remote_kubernetes_timeout",
            "远端 Kubernetes 查询超时。",
        ));
    }
    if output.output_truncated {
        return Err(AppError::new(
            "remote_kubernetes_output_limit",
            "远端 Kubernetes 查询结果超过安全上限。",
        ));
    }
    if output.exit_code != Some(0) {
        return Err(AppError::new(
            "remote_kubernetes_query_failed",
            command_failure_message(&output, "远端 Kubernetes 查询失败"),
        ));
    }
    serde_json::from_str(&output.stdout).map_err(|error| {
        AppError::new(
            "remote_kubernetes_invalid_json",
            format!("远端 kubectl 未返回有效 JSON：{error}"),
        )
    })
}

fn remote_kubectl_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    query: &KubernetesResourceQuery,
    name: Option<&str>,
) -> AppResult<String> {
    let descriptor = resource_descriptor(query)?;
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let context = shell_quote(&query.context.name)?;
    let mut arguments = vec![executable, format!("--context {context}")];
    if let Some(kubeconfig_path) = kubeconfig_path.filter(|value| !value.trim().is_empty()) {
        arguments.push(format!("--kubeconfig {}", shell_quote(kubeconfig_path)?));
    }
    arguments.push("get".to_string());
    arguments.push(descriptor.plural.to_string());
    if let Some(name) = name {
        arguments.push(shell_quote(name)?);
    }
    if descriptor.namespaced {
        if let Some(namespace) = query
            .namespace
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            arguments.push(format!("--namespace {}", shell_quote(namespace)?));
        } else {
            arguments.push("--all-namespaces".to_string());
        }
    }
    if let Some(selector) = query
        .label_selector
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        arguments.push(format!("--selector {}", shell_quote(selector)?));
    }
    if name.is_none() {
        arguments.push(format!("--chunk-size={}", query.limit.clamp(1, 500)));
    }
    arguments.push("--output=json".to_string());
    Ok(arguments.join(" "))
}

fn remote_logs_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesPodLogsRequest,
) -> AppResult<String> {
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut arguments = vec![
        executable,
        format!("--context {}", shell_quote(&request.context.name)?),
    ];
    if let Some(path) = kubeconfig_path.filter(|value| !value.trim().is_empty()) {
        arguments.push(format!("--kubeconfig {}", shell_quote(path)?));
    }
    arguments.push("logs".to_string());
    arguments.push(shell_quote(&request.pod)?);
    arguments.push(format!(
        "--namespace {}",
        shell_quote(request.namespace.as_deref().unwrap_or("default"))?
    ));
    if let Some(container) = request
        .container
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        arguments.push(format!("--container {}", shell_quote(container)?));
    }
    if let Some(tail_lines) = request.tail_lines {
        arguments.push(format!("--tail={}", tail_lines.clamp(1, 100_000)));
    }
    if let Some(since_seconds) = request.since_seconds {
        arguments.push(format!("--since={}s", since_seconds.clamp(1, 31_536_000)));
    }
    if request.timestamps {
        arguments.push("--timestamps".to_string());
    }
    if request.previous {
        arguments.push("--previous".to_string());
    }
    Ok(arguments.join(" "))
}

fn remote_cli_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    context: &KubernetesContextSelection,
) -> AppResult<String> {
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut arguments = vec![
        executable,
        format!("--context {}", shell_quote(&context.name)?),
    ];
    if let Some(path) = kubeconfig_path.filter(|value| !value.trim().is_empty()) {
        arguments.push(format!("--kubeconfig {}", shell_quote(path)?));
    }
    if let Some(namespace) = context
        .namespace
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        arguments.push(format!("--namespace {}", shell_quote(namespace)?));
    }
    arguments.push("get pods".to_string());
    Ok(arguments.join(" "))
}

fn local_cli_command(
    kubeconfig_paths: &[String],
    context: &KubernetesContextSelection,
) -> AppResult<String> {
    let mut command = "kubectl".to_string();
    if !kubeconfig_paths.is_empty() {
        let separator = if cfg!(windows) { ";" } else { ":" };
        let paths = kubeconfig_paths
            .iter()
            .filter(|path| !path.trim().is_empty())
            .map(|path| expand_local_path(path.trim()).to_string_lossy().to_string())
            .collect::<Vec<_>>();
        if !paths.is_empty() {
            let value = paths.join(separator);
            command = if cfg!(windows) {
                format!("$env:KUBECONFIG={}; {command}", powershell_quote(&value))
            } else {
                format!("KUBECONFIG={} {command}", shell_quote(&value)?)
            };
        }
    }
    if cfg!(windows) {
        command.push_str(&format!(" --context {}", powershell_quote(&context.name)));
        if let Some(namespace) = context
            .namespace
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(&format!(" --namespace {}", powershell_quote(namespace)));
        }
    } else {
        command.push_str(&format!(" --context {}", shell_quote(&context.name)?));
        if let Some(namespace) = context
            .namespace
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.push_str(&format!(" --namespace {}", shell_quote(namespace)?));
        }
    }
    command.push_str(" get pods");
    Ok(command)
}

async fn local_kubectl_version() -> Option<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        tokio::process::Command::new("kubectl")
            .args(["version", "--client", "--output=json"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice::<serde_json::Value>(&output.stdout)
        .ok()?
        .pointer("/clientVersion/gitVersion")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn pod_log_params(request: &KubernetesPodLogsRequest) -> LogParams {
    LogParams {
        container: request
            .container
            .clone()
            .filter(|value| !value.trim().is_empty()),
        tail_lines: request.tail_lines.map(|value| value.clamp(1, 100_000)),
        since_seconds: request
            .since_seconds
            .map(|value| value.clamp(1, 31_536_000)),
        timestamps: request.timestamps,
        previous: request.previous,
        ..Default::default()
    }
}

fn truncate_log(mut content: String) -> (String, bool) {
    if content.len() <= LOG_MAX_OUTPUT_BYTES {
        return (content, false);
    }
    let mut boundary = LOG_MAX_OUTPUT_BYTES;
    while !content.is_char_boundary(boundary) {
        boundary -= 1;
    }
    content.truncate(boundary);
    (content, true)
}

async fn follow_local_pod_logs(
    app_handle: &AppHandle,
    operation_id: &str,
    kubeconfig_paths: &[String],
    request: &KubernetesPodLogsRequest,
    manager: &KubernetesManager,
    mut cancelled: watch::Receiver<bool>,
) -> AppResult<()> {
    let client = manager
        .local_client(kubeconfig_paths, &request.context)
        .await?;
    let namespace = request.namespace.as_deref().unwrap_or("default");
    let api: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client, namespace);
    let mut params = pod_log_params(request);
    params.follow = true;
    let stream = api
        .log_stream(&request.pod, &params)
        .await
        .map_err(|error| {
            AppError::new(
                "kubernetes_log_follow_failed",
                format!("开始 Pod 日志跟随失败：{error}"),
            )
        })?;
    let mut lines = stream.lines();
    let mut emitted_bytes = 0usize;
    loop {
        tokio::select! {
            changed = cancelled.changed() => {
                if changed.is_ok() && *cancelled.borrow() {
                    emit_pod_log_event(app_handle, operation_id, "cancelled", None, None);
                    return Ok(());
                }
            }
            line = lines.next() => match line {
                Some(Ok(line)) => {
                    let data = format!("{line}\n");
                    if !emit_pod_log_chunk(app_handle, operation_id, &data, &mut emitted_bytes) {
                        return Ok(());
                    }
                }
                None => {
                    emit_pod_log_event(app_handle, operation_id, "completed", None, None);
                    return Ok(());
                }
                Some(Err(error)) => return Err(AppError::new("kubernetes_log_follow_failed", format!("读取 Pod 日志失败：{error}"))),
            }
        }
    }
}

struct RemotePodLogFollowInput<'a> {
    app_handle: &'a AppHandle,
    operation_id: &'a str,
    profile: &'a SshProfile,
    kubeconfig_path: Option<&'a str>,
    kubectl_path: Option<&'a str>,
    request: &'a KubernetesPodLogsRequest,
    pool: &'a SshConnectionPool,
    cancelled: watch::Receiver<bool>,
}

async fn follow_remote_pod_logs(input: RemotePodLogFollowInput<'_>) -> AppResult<()> {
    let RemotePodLogFollowInput {
        app_handle,
        operation_id,
        profile,
        kubeconfig_path,
        kubectl_path,
        request,
        pool,
        mut cancelled,
    } = input;
    let mut effective_request = request.clone();
    effective_request.tail_lines = effective_request.tail_lines.or(Some(2_000));
    // The command is always constructed by Rust; `--follow` is appended only
    // after the normal bounded log arguments have been validated.
    let command = format!(
        "{} --follow",
        remote_logs_command(kubeconfig_path, kubectl_path, &effective_request)?
    );
    let transport = pool.acquire(profile.clone(), ChannelOwner::Exec).await?;
    let (mut channel, _channel_lease) = transport.open_session_channel().await?;
    if channel.exec(true, command.as_bytes()).await.is_err() {
        transport.invalidate().await;
        return Err(crate::ssh::transport_recovering_error());
    }

    let mut emitted_bytes = 0usize;
    loop {
        tokio::select! {
            changed = cancelled.changed() => {
                if changed.is_ok() && *cancelled.borrow() {
                    let _ = channel.close().await;
                    emit_pod_log_event(app_handle, operation_id, "cancelled", None, None);
                    return Ok(());
                }
            }
            message = channel.wait() => match message {
                Some(ChannelMsg::Data { data }) => {
                    let text = String::from_utf8_lossy(&data).to_string();
                    if !emit_pod_log_chunk(app_handle, operation_id, &text, &mut emitted_bytes) {
                        let _ = channel.close().await;
                        return Ok(());
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let text = String::from_utf8_lossy(&data).to_string();
                    if !text.trim().is_empty() {
                        emit_pod_log_event(app_handle, operation_id, "error", None, Some(text.trim().to_string()));
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) if exit_status != 0 => {
                    return Err(AppError::new("remote_kubernetes_log_follow_failed", format!("远端 kubectl logs 已退出（退出码 {exit_status}）。")));
                }
                Some(ChannelMsg::Close) | None => {
                    emit_pod_log_event(app_handle, operation_id, "completed", None, None);
                    return Ok(());
                }
                _ => {}
            }
        }
    }
}

fn emit_pod_log_chunk(
    app_handle: &AppHandle,
    operation_id: &str,
    data: &str,
    emitted_bytes: &mut usize,
) -> bool {
    let remaining = LOG_MAX_OUTPUT_BYTES.saturating_sub(*emitted_bytes);
    if remaining == 0 {
        emit_pod_log_event(app_handle, operation_id, "truncated", None, None);
        return false;
    }
    let chunk = if data.len() > remaining {
        let mut boundary = remaining;
        while !data.is_char_boundary(boundary) {
            boundary -= 1;
        }
        &data[..boundary]
    } else {
        data
    };
    *emitted_bytes += chunk.len();
    emit_pod_log_event(
        app_handle,
        operation_id,
        "data",
        Some(chunk.to_string()),
        None,
    );
    if chunk.len() != data.len() {
        emit_pod_log_event(app_handle, operation_id, "truncated", None, None);
        return false;
    }
    true
}

fn emit_pod_log_event(
    app_handle: &AppHandle,
    operation_id: &str,
    event_type: &str,
    data: Option<String>,
    message: Option<String>,
) {
    let _ = app_handle.emit(
        POD_LOG_EVENT,
        KubernetesPodLogEvent {
            operation_id: operation_id.to_string(),
            event_type: event_type.to_string(),
            data,
            message,
        },
    );
}

fn list_params(query: &KubernetesResourceQuery) -> AppResult<ListParams> {
    let mut params = ListParams::default();
    if let Some(label_selector) = query
        .label_selector
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        validate_selector(label_selector)?;
        params = params.labels(label_selector);
    }
    params.limit = Some(query.limit.clamp(1, 500));
    params.continue_token = query
        .continue_token
        .clone()
        .filter(|value| !value.trim().is_empty());
    Ok(params)
}

struct ResourceDescriptor {
    api_resource: ApiResource,
    plural: String,
    namespaced: bool,
}

fn resource_descriptor(query: &KubernetesResourceQuery) -> AppResult<ResourceDescriptor> {
    let resource = query.resource.as_str();
    let (group, version, kind, plural, namespaced) = match resource {
        "pods" => ("", "v1", "Pod", "pods", true),
        "services" => ("", "v1", "Service", "services", true),
        "events" => ("events.k8s.io", "v1", "Event", "events", true),
        "configmaps" => ("", "v1", "ConfigMap", "configmaps", true),
        "secrets" => ("", "v1", "Secret", "secrets", true),
        "namespaces" => ("", "v1", "Namespace", "namespaces", false),
        "nodes" => ("", "v1", "Node", "nodes", false),
        "deployments" => ("apps", "v1", "Deployment", "deployments", true),
        _ => return dynamic_resource_descriptor(query),
    };
    let gvk = GroupVersionKind::gvk(group, version, kind);
    Ok(ResourceDescriptor {
        api_resource: ApiResource::from_gvk_with_plural(&gvk, plural),
        plural: plural.to_string(),
        namespaced,
    })
}

fn dynamic_resource_descriptor(query: &KubernetesResourceQuery) -> AppResult<ResourceDescriptor> {
    let api_version = query.api_version.as_deref().ok_or_else(|| {
        AppError::new(
            "kubernetes_resource_unsupported",
            "未知资源必须来自 Kubernetes API Discovery。",
        )
    })?;
    let kind = query
        .kind
        .as_deref()
        .ok_or_else(|| AppError::new("kubernetes_resource_unsupported", "未知资源缺少 kind。"))?;
    let namespaced = query
        .namespaced
        .ok_or_else(|| AppError::new("kubernetes_resource_unsupported", "未知资源缺少 scope。"))?;
    validate_dynamic_resource_value(&query.resource, "资源")?;
    validate_dynamic_resource_value(api_version, "apiVersion")?;
    validate_dynamic_resource_value(kind, "kind")?;
    let (group, version) = api_version.split_once('/').unwrap_or(("", api_version));
    if version.is_empty() {
        return Err(AppError::new(
            "kubernetes_resource_unsupported",
            "apiVersion 无效。",
        ));
    }
    let plural = query
        .resource
        .rsplit('/')
        .next()
        .unwrap_or(&query.resource)
        .to_string();
    Ok(ResourceDescriptor {
        api_resource: ApiResource::from_gvk_with_plural(
            &GroupVersionKind::gvk(group, version, kind),
            &plural,
        ),
        plural,
        namespaced,
    })
}

fn validate_dynamic_resource_value(value: &str, field: &str) -> AppResult<()> {
    if value.is_empty()
        || value.len() > 253
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '/')
        })
    {
        return Err(AppError::new(
            "kubernetes_resource_unsupported",
            format!("{field} 格式无效。"),
        ));
    }
    Ok(())
}

fn resource_list_from_value(
    value: serde_json::Value,
    query: &KubernetesResourceQuery,
) -> AppResult<KubernetesResourceList> {
    let items = value
        .get("items")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_invalid_response",
                "Kubernetes 返回的资源列表格式无效。",
            )
        })?
        .iter()
        .cloned()
        .map(resource_item_from_value)
        .collect::<AppResult<Vec<_>>>()?;
    Ok(KubernetesResourceList {
        items,
        namespace: query.namespace.clone(),
        resource: query.resource.clone(),
        continue_token: value
            .pointer("/metadata/continue")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

fn resource_document_from_value(value: serde_json::Value) -> AppResult<KubernetesResourceDocument> {
    let item = resource_item_from_value(value.clone())?;
    let (json, redacted) = redact_resource(value, &item.kind);
    let yaml = serde_yaml::to_string(&json).map_err(|error| {
        AppError::new(
            "kubernetes_yaml_error",
            format!("无法渲染资源 YAML：{error}"),
        )
    })?;
    Ok(KubernetesResourceDocument {
        item,
        json,
        yaml,
        redacted,
    })
}

fn resource_item_from_value(value: serde_json::Value) -> AppResult<KubernetesResourceItem> {
    let metadata = value
        .get("metadata")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_invalid_response",
                "Kubernetes 资源缺少 metadata。",
            )
        })?;
    let name = metadata
        .get("name")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("kubernetes_invalid_response", "Kubernetes 资源缺少名称。"))?;
    let labels = metadata
        .get("labels")
        .and_then(serde_json::Value::as_object)
        .map(|labels| {
            labels
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| KubernetesLabel {
                        key: key.clone(),
                        value: value.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(KubernetesResourceItem {
        api_version: value
            .get("apiVersion")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        kind: value
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        name: name.to_string(),
        namespace: metadata
            .get("namespace")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        resource_version: metadata
            .get("resourceVersion")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        created_at: metadata
            .get("creationTimestamp")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        status: resource_status(&value),
        labels,
    })
}

fn resource_status(value: &serde_json::Value) -> Option<String> {
    value
        .pointer("/status/phase")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .pointer("/status/availableReplicas")
                .and_then(serde_json::Value::as_i64)
                .map(|value| format!("{value} available"))
        })
        .or_else(|| {
            value
                .get("type")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
}

fn redact_resource(mut value: serde_json::Value, kind: &str) -> (serde_json::Value, bool) {
    if !kind.eq_ignore_ascii_case("Secret") {
        return (value, false);
    }
    let object = value
        .as_object_mut()
        .expect("resource item must be an object");
    let data_keys = object
        .get("data")
        .and_then(serde_json::Value::as_object)
        .map(|data| data.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let string_data_keys = object
        .get("stringData")
        .and_then(serde_json::Value::as_object)
        .map(|data| data.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let sanitized = serde_json::json!({
        "apiVersion": object.get("apiVersion").cloned().unwrap_or_default(),
        "kind": object.get("kind").cloned().unwrap_or_else(|| serde_json::Value::String("Secret".to_string())),
        "metadata": object.get("metadata").cloned().unwrap_or_default(),
        "type": object.get("type").cloned().unwrap_or_default(),
        "dataKeys": data_keys,
        "stringDataKeys": string_data_keys,
    });
    (sanitized, true)
}

fn validate_resource_query(query: &KubernetesResourceQuery) -> AppResult<()> {
    validate_resource_context(&query.context)?;
    resource_descriptor(query)?;
    validate_namespace(query.namespace.as_deref())?;
    if let Some(selector) = query.label_selector.as_deref() {
        validate_selector(selector)?;
    }
    if query.continue_token.as_ref().is_some_and(|value| {
        value.len() > MAX_REMOTE_VALUE_LEN || value.chars().any(char::is_control)
    }) {
        return Err(AppError::new(
            "kubernetes_continue_token_invalid",
            "分页令牌无效。",
        ));
    }
    Ok(())
}

fn validate_resource_document_request(
    request: &KubernetesResourceDocumentRequest,
) -> AppResult<()> {
    validate_resource_context(&request.context)?;
    resource_descriptor(&KubernetesResourceQuery {
        profile_id: request.profile_id.clone(),
        context: request.context.clone(),
        resource: request.resource.clone(),
        api_version: request.api_version.clone(),
        kind: request.kind.clone(),
        namespaced: request.namespaced,
        namespace: request.namespace.clone(),
        label_selector: None,
        limit: 1,
        continue_token: None,
    })?;
    validate_remote_value(&request.name, "资源名称")?;
    validate_namespace(request.namespace.as_deref())
}

fn validate_pod_logs_request(request: &KubernetesPodLogsRequest) -> AppResult<()> {
    validate_resource_context(&request.context)?;
    validate_remote_value(&request.pod, "Pod 名称")?;
    validate_namespace(request.namespace.as_deref())?;
    if let Some(container) = request
        .container
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        validate_remote_value(container, "container 名称")?;
    }
    if request
        .tail_lines
        .is_some_and(|value| !(1..=100_000).contains(&value))
    {
        return Err(AppError::new(
            "kubernetes_log_tail_invalid",
            "日志行数必须在 1 到 100000 之间。",
        ));
    }
    if request
        .since_seconds
        .is_some_and(|value| !(1..=31_536_000).contains(&value))
    {
        return Err(AppError::new(
            "kubernetes_log_since_invalid",
            "日志时间范围无效。",
        ));
    }
    Ok(())
}

fn is_valid_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn validate_resource_context(context: &KubernetesContextSelection) -> AppResult<()> {
    validate_remote_value(&context.source_id, "context 来源")?;
    validate_remote_value(&context.name, "context 名称")
}

fn validate_namespace(namespace: Option<&str>) -> AppResult<()> {
    if let Some(namespace) = namespace.filter(|value| !value.trim().is_empty()) {
        validate_remote_value(namespace, "namespace")?;
    }
    Ok(())
}

fn validate_selector(selector: &str) -> AppResult<()> {
    if selector.len() > MAX_REMOTE_VALUE_LEN || selector.chars().any(char::is_control) {
        return Err(AppError::new(
            "kubernetes_selector_invalid",
            "标签选择器无效。",
        ));
    }
    Ok(())
}

fn resolve_local_kubeconfig_paths(paths: &[String]) -> AppResult<Vec<PathBuf>> {
    let paths: Vec<PathBuf> = if paths.iter().any(|path| !path.trim().is_empty()) {
        paths
            .iter()
            .filter(|path| !path.trim().is_empty())
            .map(|path| expand_local_path(path.trim()))
            .collect()
    } else if let Some(value) = std::env::var_os("KUBECONFIG") {
        std::env::split_paths(&value)
            .filter(|path| !path.as_os_str().is_empty())
            .collect()
    } else {
        vec![local_home_path()?.join(".kube").join("config")]
    };

    if paths.is_empty() {
        return Err(AppError::new(
            "kubeconfig_path_missing",
            "未找到可用 kubeconfig 路径。",
        ));
    }

    let mut seen = HashSet::new();
    Ok(paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect())
}

fn local_home_path() -> AppResult<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| AppError::new("home_directory_missing", "无法确定本机用户目录。"))
}

fn expand_local_path(value: &str) -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home
        && let Some(suffix) = value
            .strip_prefix("~/")
            .or_else(|| value.strip_prefix("~\\"))
    {
        return PathBuf::from(home).join(suffix);
    }
    PathBuf::from(value)
}

fn context_summaries(config: &Kubeconfig, source_id: &str) -> Vec<KubernetesContextSummary> {
    config
        .contexts
        .iter()
        .filter_map(|named| {
            let context = named.context.as_ref()?;
            Some(KubernetesContextSummary {
                source_id: source_id.to_string(),
                name: named.name.clone(),
                cluster: context.cluster.clone(),
                user: context.user.clone(),
                namespace: context.namespace.clone(),
                is_current: false,
            })
        })
        .collect()
}

async fn discover_remote_kubectl_path(
    profile: &SshProfile,
    pool: &SshConnectionPool,
) -> AppResult<Option<String>> {
    let output = run_remote(
        profile,
        "command -v kubectl 2>/dev/null || true",
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if output.output_truncated {
        return Err(AppError::new(
            "remote_kubernetes_output_limit",
            "远端 kubectl 路径探测输出超过安全上限。",
        ));
    }
    let path = output.stdout.lines().next().unwrap_or_default().trim();
    if path.is_empty() {
        return Ok(None);
    }
    validate_remote_value(path, "自动发现的 kubectl 路径")?;
    Ok(Some(path.to_string()))
}

async fn discover_remote_kubectl_version(
    profile: &SshProfile,
    kubectl_path: &str,
    pool: &SshConnectionPool,
) -> AppResult<Option<String>> {
    let executable = shell_quote(kubectl_path)?;
    let output = run_remote(
        profile,
        &format!("{executable} version --client --output=json 2>/dev/null"),
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if output.exit_code == Some(0)
        && !output.output_truncated
        && let Ok(value) = serde_json::from_str::<serde_json::Value>(&output.stdout)
        && let Some(version) = value
            .pointer("/clientVersion/gitVersion")
            .and_then(serde_json::Value::as_str)
    {
        return Ok(Some(version.to_string()));
    }

    let fallback = run_remote(
        profile,
        &format!("{executable} version --client 2>/dev/null"),
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if fallback.exit_code == Some(0) && !fallback.output_truncated {
        let version = fallback.stdout.lines().next().unwrap_or_default().trim();
        if !version.is_empty() {
            return Ok(Some(version.to_string()));
        }
    }
    Ok(None)
}

async fn discover_remote_kubeconfig_paths(
    profile: &SshProfile,
    pool: &SshConnectionPool,
) -> AppResult<Vec<String>> {
    let output = run_remote(
        profile,
        REMOTE_CANDIDATE_PATHS_COMMAND,
        DISCOVERY_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if output.output_truncated {
        return Err(AppError::new(
            "remote_kubernetes_output_limit",
            "远端 kubeconfig 路径探测输出超过安全上限。",
        ));
    }

    let mut seen = HashSet::new();
    Ok(output
        .stdout
        .lines()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter(|path| validate_remote_value(path, "自动发现的 kubeconfig 路径").is_ok())
        .filter(|path| seen.insert((*path).to_string()))
        .map(str::to_string)
        .collect())
}

async fn discover_remote_candidate(
    profile: &SshProfile,
    kubectl_path: &str,
    kubeconfig_path: &str,
    pool: &SshConnectionPool,
) -> RemoteKubeconfigCandidate {
    let executable = match shell_quote(kubectl_path) {
        Ok(value) => value,
        Err(error) => return candidate_error(kubeconfig_path, error.message),
    };
    let config = match shell_quote(kubeconfig_path) {
        Ok(value) => value,
        Err(error) => return candidate_error(kubeconfig_path, error.message),
    };
    let jsonpath = match shell_quote(CONTEXT_JSONPATH) {
        Ok(value) => value,
        Err(error) => return candidate_error(kubeconfig_path, error.message),
    };

    let contexts_output = match run_remote(
        profile,
        &format!("{executable} --kubeconfig {config} config view --output=jsonpath={jsonpath}"),
        DISCOVERY_MAX_OUTPUT_BYTES,
        pool,
    )
    .await
    {
        Ok(output) if output.exit_code == Some(0) && !output.output_truncated => output,
        Ok(output) => {
            return candidate_error(
                kubeconfig_path,
                command_failure_message(&output, "无法读取远端 kubeconfig context"),
            );
        }
        Err(error) => return candidate_error(kubeconfig_path, error.message),
    };

    let current_context = run_remote(
        profile,
        &format!("{executable} --kubeconfig {config} config current-context 2>/dev/null"),
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await
    .ok()
    .filter(|output| output.exit_code == Some(0) && !output.output_truncated)
    .and_then(|output| {
        output
            .stdout
            .lines()
            .next()
            .map(str::trim)
            .map(str::to_string)
    })
    .filter(|value| !value.is_empty());

    let mut contexts = parse_remote_context_rows(&contexts_output.stdout, kubeconfig_path);
    for context in &mut contexts {
        context.is_current = current_context.as_deref() == Some(context.name.as_str());
    }

    RemoteKubeconfigCandidate {
        path: kubeconfig_path.to_string(),
        contexts,
        current_context,
        error: None,
    }
}

fn candidate_error(path: &str, error: String) -> RemoteKubeconfigCandidate {
    RemoteKubeconfigCandidate {
        path: path.to_string(),
        contexts: Vec::new(),
        current_context: None,
        error: Some(error),
    }
}

fn parse_remote_context_rows(output: &str, source_id: &str) -> Vec<KubernetesContextSummary> {
    output
        .lines()
        .filter_map(|line| {
            let mut values = line.splitn(4, '\t');
            let name = values.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let cluster = values.next().unwrap_or_default().trim();
            let user = values.next().unwrap_or_default().trim();
            let namespace = values.next().unwrap_or_default().trim();
            Some(KubernetesContextSummary {
                source_id: source_id.to_string(),
                name: name.to_string(),
                cluster: cluster.to_string(),
                user: (!user.is_empty()).then(|| user.to_string()),
                namespace: (!namespace.is_empty()).then(|| namespace.to_string()),
                is_current: false,
            })
        })
        .collect()
}

async fn run_remote(
    profile: &SshProfile,
    command: &str,
    max_output_bytes: usize,
    pool: &SshConnectionPool,
) -> AppResult<CommandOutput> {
    let output = run_ssh_command_with_limit(
        profile.clone(),
        command.to_string(),
        DISCOVERY_TIMEOUT_SECS,
        max_output_bytes,
        pool,
    )
    .await?;
    if output.timed_out {
        return Err(AppError::new(
            "remote_kubernetes_timeout",
            "远端 Kubernetes 探测超时。",
        ));
    }
    Ok(output)
}

fn command_failure_message(output: &CommandOutput, action: &str) -> String {
    if output.output_truncated {
        return format!("{action}：输出超过安全上限。");
    }
    match output.exit_code {
        Some(code) => format!("{action}（退出码 {code}）。"),
        None => format!("{action}。"),
    }
}

fn validate_remote_value(value: &str, field_name: &str) -> AppResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_REMOTE_VALUE_LEN || trimmed.contains('\0') {
        return Err(AppError::new(
            "remote_kubernetes_value_invalid",
            format!("{field_name}无效。"),
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::new(
            "remote_kubernetes_value_invalid",
            format!("{field_name}不能包含控制字符。"),
        ));
    }
    Ok(())
}

/// POSIX single-quote escaping for the SSH exec command string.
fn shell_quote(value: &str) -> AppResult<String> {
    validate_remote_value(value, "远端参数")?;
    Ok(format!("'{}'", value.replace('\'', "'\"'\"'")))
}

#[cfg(test)]
mod tests {
    use super::{
        context_summaries, parse_remote_context_rows, remote_cli_command, shell_quote, truncate_log,
    };
    use crate::models::kubernetes::KubernetesContextSelection;
    use kube::config::Kubeconfig;

    #[test]
    fn config_scan_only_returns_non_secret_context_metadata() {
        let config = Kubeconfig::from_yaml(
            r#"
apiVersion: v1
clusters:
- name: production
  cluster:
    server: https://api.example.invalid
users:
- name: operator
  user:
    token: should-never-cross-tauri
contexts:
- name: prod
  context:
    cluster: production
    user: operator
    namespace: platform
current-context: prod
"#,
        )
        .expect("fixture parses");

        let contexts = context_summaries(&config, "fixture");
        assert_eq!(contexts.len(), 1);
        assert_eq!(contexts[0].name, "prod");
        assert_eq!(contexts[0].cluster, "production");
        assert_eq!(contexts[0].user.as_deref(), Some("operator"));
        let serialized = serde_json::to_string(&contexts).expect("serializes");
        assert!(!serialized.contains("should-never-cross-tauri"));
        assert!(!serialized.contains("api.example.invalid"));
    }

    #[test]
    fn shell_quoting_blocks_command_injection() {
        assert_eq!(
            shell_quote("/tmp/config; rm -rf /").expect("quotes semicolon"),
            "'/tmp/config; rm -rf /'"
        );
        assert_eq!(
            shell_quote("a'b").expect("quotes apostrophe"),
            "'a'\"'\"'b'"
        );
        assert!(shell_quote("/tmp/config\nrm -rf /").is_err());
    }

    #[test]
    fn remote_context_rows_keep_empty_optional_values_empty() {
        let contexts = parse_remote_context_rows(
            "prod\tcluster-a\toperator\tplatform\nplain\tcluster-b\t\t\n",
            "remote",
        );
        assert_eq!(contexts.len(), 2);
        assert_eq!(contexts[0].namespace.as_deref(), Some("platform"));
        assert_eq!(contexts[1].user, None);
        assert_eq!(contexts[1].namespace, None);
    }

    #[test]
    fn cli_command_quotes_context_and_kubeconfig() {
        let command = remote_cli_command(
            Some("/srv/kube config"),
            Some("/usr/local/bin/kubectl"),
            &KubernetesContextSelection {
                source_id: "/srv/kube config".to_string(),
                name: "prod; echo unsafe".to_string(),
                namespace: Some("team a".to_string()),
            },
        )
        .expect("command builds");
        assert!(command.contains("--context 'prod; echo unsafe'"));
        assert!(command.contains("--kubeconfig '/srv/kube config'"));
        assert!(command.contains("--namespace 'team a'"));
    }

    #[test]
    fn log_truncation_keeps_utf8_boundary() {
        let (content, truncated) = truncate_log("x".repeat(2 * 1024 * 1024 + 1));
        assert!(truncated);
        assert_eq!(content.len(), 2 * 1024 * 1024);
    }
}
