//! Kubernetes source-aware backend.
//!
//! Kubeconfig content is never persisted in SQLite or returned to the WebView.
//! Imported content is held only by the platform credential store. Resource
//! changes are routed through the same source-aware backend boundary as reads
//! and remain subject to RBAC and explicit UI confirmation.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};

use futures::{AsyncBufReadExt, StreamExt, stream};
use keyring::Entry as KeyringEntry;
use kube::{
    Client,
    api::{
        Api, DeleteParams, DynamicObject, ListParams, LogParams, Patch, PatchParams, PostParams,
        Preconditions, WatchEvent, WatchParams,
    },
    config::{KubeConfigOptions, Kubeconfig},
    core::{ApiResource, GroupVersionKind},
    discovery::{Discovery, Scope, verbs},
};
use rand::random;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex as AsyncMutex, watch};

use crate::{
    error::{AppError, AppResult},
    models::{
        kubernetes::{
            ImportLocalKubeconfigRequest, ImportLocalKubeconfigResult, KubernetesActionResult,
            KubernetesApplyPreview, KubernetesApplyRequest, KubernetesApplyResult,
            KubernetesCapabilities, KubernetesCapabilityRequest, KubernetesConnectionTestRequest,
            KubernetesConnectionTestResult, KubernetesContextSelection, KubernetesContextSummary,
            KubernetesDeleteItemResult, KubernetesDeleteRequest, KubernetesDeleteResult,
            KubernetesDryRunRequest, KubernetesDryRunResult, KubernetesExecLaunch,
            KubernetesExecPluginSummary, KubernetesExecPluginTrustRequest, KubernetesLabel,
            KubernetesManifestSummary, KubernetesMetricsRequest, KubernetesMetricsResult,
            KubernetesOwnerReference, KubernetesPermissionCheck, KubernetesPodExecRequest,
            KubernetesPodLogEvent, KubernetesPodLogs, KubernetesPodLogsRequest,
            KubernetesPortForwardEvent, KubernetesPortForwardInfo, KubernetesPortForwardRequest,
            KubernetesProfile, KubernetesResourceDocument, KubernetesResourceDocumentRequest,
            KubernetesResourceItem, KubernetesResourceList, KubernetesResourceQuery,
            KubernetesResourceWatchEvent, KubernetesResourceWatchRequest, KubernetesRolloutRequest,
            KubernetesScaleRequest, KubernetesSource, LocalKubeconfigScanRequest,
            LocalKubeconfigScanResult, RemoteKubeconfigCandidate, RemoteKubernetesDiscoveryRequest,
            RemoteKubernetesDiscoveryResult,
        },
        ssh_profile::SshProfile,
    },
    ssh::{
        ChannelOwner, CommandOutput, SshConnectionPool, run_ssh_command_with_input,
        run_ssh_command_with_limit,
    },
};

const DISCOVERY_TIMEOUT_SECS: u64 = 12;
const DISCOVERY_MAX_OUTPUT_BYTES: usize = 128 * 1024;
const VERSION_MAX_OUTPUT_BYTES: usize = 16 * 1024;
const MAX_REMOTE_VALUE_LEN: usize = 4096;
const RESOURCE_MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const LOG_MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub const POD_LOG_EVENT: &str = "kubernetes://pod-log";
pub const RESOURCE_WATCH_EVENT: &str = "kubernetes://resource-watch";
pub const PORT_FORWARD_EVENT: &str = "kubernetes://port-forward";
static NEXT_LOG_OPERATION_ID: AtomicU64 = AtomicU64::new(1);
const RESOURCE_TIMEOUT_SECS: u64 = 20;
const MANIFEST_MAX_BYTES: usize = 512 * 1024;
const MANIFEST_MAX_DOCUMENTS: usize = 32;
const IMPORTED_KUBECONFIG_MAX_BYTES: usize = 5 * 1024 * 1024;
const IMPORTED_KUBECONFIG_SERVICE: &str = "Duo SSH Kubernetes kubeconfig";
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

#[derive(Clone, Copy)]
struct PermissionProbe {
    resource: &'static str,
    api_group: &'static str,
    verb: &'static str,
    namespaced: bool,
}

/// The actions currently exposed by the read-only workspace and the planned
/// guarded write / interactive stages. Probing them up front keeps UI affordances
/// source-independent and avoids treating an inconclusive permission check as a
/// denial.
const WORKSPACE_PERMISSION_PROBES: &[PermissionProbe] = &[
    PermissionProbe {
        resource: "pods",
        api_group: "",
        verb: "list",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods",
        api_group: "",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods",
        api_group: "",
        verb: "watch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods",
        api_group: "",
        verb: "create",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods",
        api_group: "",
        verb: "patch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods",
        api_group: "",
        verb: "delete",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods/log",
        api_group: "",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods/exec",
        api_group: "",
        verb: "create",
        namespaced: true,
    },
    PermissionProbe {
        resource: "pods/portforward",
        api_group: "",
        verb: "create",
        namespaced: true,
    },
    PermissionProbe {
        resource: "deployments",
        api_group: "apps",
        verb: "list",
        namespaced: true,
    },
    PermissionProbe {
        resource: "deployments",
        api_group: "apps",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "deployments",
        api_group: "apps",
        verb: "watch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "deployments",
        api_group: "apps",
        verb: "create",
        namespaced: true,
    },
    PermissionProbe {
        resource: "deployments",
        api_group: "apps",
        verb: "patch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "deployments",
        api_group: "apps",
        verb: "delete",
        namespaced: true,
    },
    PermissionProbe {
        resource: "services",
        api_group: "",
        verb: "list",
        namespaced: true,
    },
    PermissionProbe {
        resource: "services",
        api_group: "",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "services",
        api_group: "",
        verb: "create",
        namespaced: true,
    },
    PermissionProbe {
        resource: "services",
        api_group: "",
        verb: "patch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "services",
        api_group: "",
        verb: "delete",
        namespaced: true,
    },
    PermissionProbe {
        resource: "configmaps",
        api_group: "",
        verb: "list",
        namespaced: true,
    },
    PermissionProbe {
        resource: "configmaps",
        api_group: "",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "configmaps",
        api_group: "",
        verb: "create",
        namespaced: true,
    },
    PermissionProbe {
        resource: "configmaps",
        api_group: "",
        verb: "patch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "configmaps",
        api_group: "",
        verb: "delete",
        namespaced: true,
    },
    PermissionProbe {
        resource: "secrets",
        api_group: "",
        verb: "list",
        namespaced: true,
    },
    PermissionProbe {
        resource: "secrets",
        api_group: "",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "events",
        api_group: "",
        verb: "list",
        namespaced: true,
    },
    PermissionProbe {
        resource: "events",
        api_group: "",
        verb: "get",
        namespaced: true,
    },
    PermissionProbe {
        resource: "events",
        api_group: "",
        verb: "watch",
        namespaced: true,
    },
    PermissionProbe {
        resource: "namespaces",
        api_group: "",
        verb: "list",
        namespaced: false,
    },
    PermissionProbe {
        resource: "namespaces",
        api_group: "",
        verb: "get",
        namespaced: false,
    },
    PermissionProbe {
        resource: "nodes",
        api_group: "",
        verb: "list",
        namespaced: false,
    },
    PermissionProbe {
        resource: "nodes",
        api_group: "",
        verb: "get",
        namespaced: false,
    },
];

/// Caches local API clients by kubeconfig fingerprint and context. A changed
/// file produces a new key; the old client is harmless and short lived with
/// the process. Credential refresh remains owned by the kube client.
#[derive(Clone)]
pub struct KubernetesManager {
    clients: Arc<Mutex<HashMap<String, Client>>>,
    log_operations: Arc<AsyncMutex<HashMap<String, watch::Sender<bool>>>>,
    resource_watch_operations: Arc<AsyncMutex<HashMap<String, watch::Sender<bool>>>>,
    port_forward_operations: Arc<AsyncMutex<HashMap<String, watch::Sender<bool>>>>,
    port_forward_infos: Arc<AsyncMutex<HashMap<String, KubernetesPortForwardInfo>>>,
    exec_plugin_trust: Arc<Mutex<ExecPluginTrustStore>>,
}

impl Default for KubernetesManager {
    fn default() -> Self {
        Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
            log_operations: Arc::new(AsyncMutex::new(HashMap::new())),
            resource_watch_operations: Arc::new(AsyncMutex::new(HashMap::new())),
            port_forward_operations: Arc::new(AsyncMutex::new(HashMap::new())),
            port_forward_infos: Arc::new(AsyncMutex::new(HashMap::new())),
            exec_plugin_trust: Arc::new(Mutex::new(ExecPluginTrustStore::default())),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedExecPluginTrust {
    #[serde(default)]
    fingerprints: HashSet<String>,
}

#[derive(Debug, Default)]
struct ExecPluginTrustStore {
    path: Option<PathBuf>,
    fingerprints: HashSet<String>,
}

#[derive(Clone, Copy)]
enum LocalKubeconfigSource<'a> {
    Paths(&'a [String]),
    Imported(&'a str),
}

fn local_kubeconfig_source(source: &KubernetesSource) -> Option<LocalKubeconfigSource<'_>> {
    match source {
        KubernetesSource::Local { kubeconfig_paths } => {
            Some(LocalKubeconfigSource::Paths(kubeconfig_paths))
        }
        KubernetesSource::LocalImported { secret_ref, .. } => {
            Some(LocalKubeconfigSource::Imported(secret_ref))
        }
        KubernetesSource::RemoteSsh { .. } => None,
    }
}

impl KubernetesManager {
    /// Exec-plugin approvals are non-secret metadata and live outside SQLite.
    /// Kubeconfig content, tokens and plugin output are never persisted here.
    pub fn initialize(app_data_dir: PathBuf) -> AppResult<Self> {
        let path = app_data_dir.join("kubernetes-exec-plugin-trust.json");
        let fingerprints = match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<PersistedExecPluginTrust>(&raw)
                .map(|store| store.fingerprints)
                .unwrap_or_default(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashSet::new(),
            Err(error) => {
                return Err(AppError::new(
                    "kubernetes_exec_trust_read_error",
                    format!("无法读取 Kubernetes 认证插件信任记录：{error}"),
                ));
            }
        };
        Ok(Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
            log_operations: Arc::new(AsyncMutex::new(HashMap::new())),
            resource_watch_operations: Arc::new(AsyncMutex::new(HashMap::new())),
            port_forward_operations: Arc::new(AsyncMutex::new(HashMap::new())),
            port_forward_infos: Arc::new(AsyncMutex::new(HashMap::new())),
            exec_plugin_trust: Arc::new(Mutex::new(ExecPluginTrustStore {
                path: Some(path),
                fingerprints,
            })),
        })
    }

    fn is_exec_plugin_trusted(&self, fingerprint: &str) -> bool {
        self.exec_plugin_trust
            .lock()
            .expect("kubernetes exec trust lock")
            .fingerprints
            .contains(fingerprint)
    }

    fn set_exec_plugin_trusted(&self, fingerprint: &str, trusted: bool) -> AppResult<()> {
        let mut store = self
            .exec_plugin_trust
            .lock()
            .expect("kubernetes exec trust lock");
        if trusted {
            store.fingerprints.insert(fingerprint.to_string());
        } else {
            store.fingerprints.remove(fingerprint);
        }
        let Some(path) = store.path.as_ref() else {
            return Ok(());
        };
        let raw = serde_json::to_vec_pretty(&PersistedExecPluginTrust {
            fingerprints: store.fingerprints.clone(),
        })
        .map_err(|error| AppError::new("kubernetes_exec_trust_write_error", error.to_string()))?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, raw).map_err(|error| {
            AppError::new(
                "kubernetes_exec_trust_write_error",
                format!("无法保存 Kubernetes 认证插件信任记录：{error}"),
            )
        })?;
        fs::rename(&temporary, path).map_err(|error| {
            AppError::new(
                "kubernetes_exec_trust_write_error",
                format!("无法更新 Kubernetes 认证插件信任记录：{error}"),
            )
        })
    }
}

impl KubernetesManager {
    async fn local_client(
        &self,
        source: LocalKubeconfigSource<'_>,
        context: &KubernetesContextSelection,
    ) -> AppResult<Client> {
        let (fingerprint, source_id, mut kubeconfig) = match source {
            LocalKubeconfigSource::Paths(kubeconfig_paths) => {
                let source_path = expand_local_path(&context.source_id);
                let allowed_paths = resolve_local_kubeconfig_paths(kubeconfig_paths)?;
                if !allowed_paths.iter().any(|path| path == &source_path) {
                    return Err(AppError::new(
                        "kubernetes_context_source_missing",
                        "所选 Kubernetes context 不属于当前配置来源。请重新扫描配置。",
                    ));
                }
                let kubeconfig = Kubeconfig::read_from(&source_path).map_err(|error| {
                    AppError::new(
                        "kubeconfig_read_error",
                        format!("无法读取 kubeconfig '{}': {error}", source_path.display()),
                    )
                })?;
                (
                    local_client_fingerprint(&source_path, context)?,
                    source_path.to_string_lossy().to_string(),
                    kubeconfig,
                )
            }
            LocalKubeconfigSource::Imported(secret_ref) => {
                let source_id = imported_source_id(secret_ref);
                if context.source_id != source_id {
                    return Err(AppError::new(
                        "kubernetes_context_source_missing",
                        "所选 Kubernetes context 不属于已导入的配置。请重新扫描配置。",
                    ));
                }
                (
                    format!("import\u{0}{secret_ref}\u{0}{}", context.name),
                    source_id,
                    self.load_imported_kubeconfig(secret_ref)?,
                )
            }
        };
        if let Some(client) = self
            .clients
            .lock()
            .expect("kubernetes client cache lock")
            .get(&fingerprint)
            .cloned()
        {
            return Ok(client);
        }
        ensure_exec_plugin_trusted(&kubeconfig, &source_id, context, self)?;
        sanitize_exec_plugin_environment(&mut kubeconfig);
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
                format!(
                    "无法加载 context（认证插件输出已隐藏）：{}",
                    kubeconfig_error_message(&error)
                ),
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

    /// Copy a kubeconfig into the platform credential store. This is kept
    /// separate from the SQLite profile repository because a kubeconfig can
    /// contain bearer tokens, certificate data and client private keys.
    fn store_imported_kubeconfig(&self, value: &[u8]) -> AppResult<String> {
        let secret_ref = format!("kubeconfig-{:032x}", random::<u128>());
        self.replace_imported_kubeconfig(&secret_ref, value)?;
        Ok(secret_ref)
    }

    fn replace_imported_kubeconfig(&self, secret_ref: &str, value: &[u8]) -> AppResult<()> {
        let entry = keyring_entry(secret_ref)?;
        entry.set_secret(value).map_err(|_| {
            AppError::new(
                "kubernetes_secure_storage_write_error",
                "无法写入系统凭据存储；Kubernetes kubeconfig 未被保存。",
            )
        })
    }

    fn load_imported_kubeconfig(&self, secret_ref: &str) -> AppResult<Kubeconfig> {
        let entry = keyring_entry(secret_ref)?;
        let value = entry.get_secret().map_err(|_| {
            AppError::new(
                "kubernetes_secure_storage_read_error",
                "无法从系统凭据存储读取 Kubernetes kubeconfig。",
            )
        })?;
        let yaml = std::str::from_utf8(&value).map_err(|_| {
            AppError::new(
                "kubernetes_secure_storage_invalid",
                "系统凭据存储中的 Kubernetes kubeconfig 格式无效。",
            )
        })?;
        Kubeconfig::from_yaml(yaml).map_err(|_| {
            AppError::new(
                "kubernetes_secure_storage_invalid",
                "系统凭据存储中的 Kubernetes kubeconfig 无法解析。",
            )
        })
    }

    pub fn delete_imported_kubeconfig(&self, secret_ref: &str) -> AppResult<()> {
        let entry = keyring_entry(secret_ref)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::new(
                "kubernetes_secure_storage_delete_error",
                "无法从系统凭据存储删除 Kubernetes kubeconfig。",
            )),
        }
    }
}

fn keyring_entry(secret_ref: &str) -> AppResult<KeyringEntry> {
    if !is_valid_imported_secret_ref(secret_ref) {
        return Err(AppError::new(
            "kubernetes_import_reference_invalid",
            "Kubernetes 导入配置引用无效。",
        ));
    }
    KeyringEntry::new(IMPORTED_KUBECONFIG_SERVICE, secret_ref).map_err(|_| {
        AppError::new(
            "kubernetes_secure_storage_unavailable",
            "系统凭据存储不可用，无法安全导入 kubeconfig。",
        )
    })
}

fn is_valid_imported_secret_ref(value: &str) -> bool {
    value.len() == "kubeconfig-".len() + 32
        && value.starts_with("kubeconfig-")
        && value["kubeconfig-".len()..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn imported_source_id(secret_ref: &str) -> String {
    format!("import:{secret_ref}")
}

/// The common non-secret read contract used by the local API and remote
/// kubectl implementations. New operations (Watch, apply, delete, exec) are
/// added here before they are exposed to Tauri, preventing frontend code from
/// branching on the source or constructing kubectl commands.
trait KubernetesBackend {
    async fn list(&self, query: &KubernetesResourceQuery) -> AppResult<serde_json::Value>;
    async fn get(
        &self,
        request: &KubernetesResourceDocumentRequest,
    ) -> AppResult<serde_json::Value>;
    async fn capabilities(
        &self,
        context: &KubernetesContextSelection,
    ) -> AppResult<KubernetesCapabilities>;
    async fn dry_run_apply(
        &self,
        request: &KubernetesApplyRequest,
    ) -> AppResult<Vec<serde_json::Value>>;
    async fn apply(&self, request: &KubernetesApplyRequest) -> AppResult<Vec<serde_json::Value>>;
    async fn delete(
        &self,
        request: &KubernetesDeleteRequest,
        dry_run: bool,
    ) -> AppResult<Vec<KubernetesDeleteItemResult>>;
}

struct LocalKubernetesBackend<'a> {
    source: LocalKubeconfigSource<'a>,
    manager: &'a KubernetesManager,
}

impl KubernetesBackend for LocalKubernetesBackend<'_> {
    async fn list(&self, query: &KubernetesResourceQuery) -> AppResult<serde_json::Value> {
        local_list_resources(self.source, query, self.manager).await
    }

    async fn get(
        &self,
        request: &KubernetesResourceDocumentRequest,
    ) -> AppResult<serde_json::Value> {
        local_get_resource(self.source, request, self.manager).await
    }

    async fn capabilities(
        &self,
        context: &KubernetesContextSelection,
    ) -> AppResult<KubernetesCapabilities> {
        let client = self.manager.local_client(self.source, context).await?;
        local_capabilities(client).await
    }

    async fn dry_run_apply(
        &self,
        request: &KubernetesApplyRequest,
    ) -> AppResult<Vec<serde_json::Value>> {
        local_apply_manifests(self.source, request, self.manager, true).await
    }

    async fn apply(&self, request: &KubernetesApplyRequest) -> AppResult<Vec<serde_json::Value>> {
        local_apply_manifests(self.source, request, self.manager, false).await
    }

    async fn delete(
        &self,
        request: &KubernetesDeleteRequest,
        dry_run: bool,
    ) -> AppResult<Vec<KubernetesDeleteItemResult>> {
        local_delete_resources(self.source, request, self.manager, dry_run).await
    }
}

struct RemoteKubernetesBackend<'a> {
    ssh_profile: SshProfile,
    kubeconfig_path: Option<&'a str>,
    kubectl_path: Option<&'a str>,
    pool: &'a SshConnectionPool,
}

impl KubernetesBackend for RemoteKubernetesBackend<'_> {
    async fn list(&self, query: &KubernetesResourceQuery) -> AppResult<serde_json::Value> {
        remote_list_resources(
            &self.ssh_profile,
            self.kubeconfig_path,
            self.kubectl_path,
            query,
            self.pool,
        )
        .await
    }

    async fn get(
        &self,
        request: &KubernetesResourceDocumentRequest,
    ) -> AppResult<serde_json::Value> {
        remote_get_resource(
            &self.ssh_profile,
            self.kubeconfig_path,
            self.kubectl_path,
            request,
            self.pool,
        )
        .await
    }

    async fn capabilities(
        &self,
        context: &KubernetesContextSelection,
    ) -> AppResult<KubernetesCapabilities> {
        remote_capabilities(
            &self.ssh_profile,
            self.kubeconfig_path,
            self.kubectl_path,
            context,
            self.pool,
        )
        .await
    }

    async fn dry_run_apply(
        &self,
        request: &KubernetesApplyRequest,
    ) -> AppResult<Vec<serde_json::Value>> {
        remote_apply_manifests(
            &self.ssh_profile,
            self.kubeconfig_path,
            self.kubectl_path,
            request,
            self.pool,
            true,
        )
        .await
    }

    async fn apply(&self, request: &KubernetesApplyRequest) -> AppResult<Vec<serde_json::Value>> {
        remote_apply_manifests(
            &self.ssh_profile,
            self.kubeconfig_path,
            self.kubectl_path,
            request,
            self.pool,
            false,
        )
        .await
    }

    async fn delete(
        &self,
        request: &KubernetesDeleteRequest,
        dry_run: bool,
    ) -> AppResult<Vec<KubernetesDeleteItemResult>> {
        remote_delete_resources(
            &self.ssh_profile,
            self.kubeconfig_path,
            self.kubectl_path,
            request,
            self.pool,
            dry_run,
        )
        .await
    }
}

fn remote_backend<'a>(
    ssh_profile_id: &str,
    kubeconfig_path: Option<&'a str>,
    kubectl_path: Option<&'a str>,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &'a SshConnectionPool,
) -> AppResult<RemoteKubernetesBackend<'a>> {
    let ssh_profile = ssh_profiles.get_profile(ssh_profile_id)?.ok_or_else(|| {
        AppError::new(
            "kubernetes_source_unavailable",
            "Kubernetes 来源所选的 SSH 连接已不存在。",
        )
    })?;
    Ok(RemoteKubernetesBackend {
        ssh_profile,
        kubeconfig_path,
        kubectl_path,
        pool,
    })
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
    manager: &KubernetesManager,
) -> AppResult<LocalKubeconfigScanResult> {
    let source_paths = resolve_local_kubeconfig_paths(&request.paths)?;
    let mut current_context = None;
    let mut contexts = Vec::new();
    let mut exec_plugins = Vec::new();
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
        exec_plugins.extend(exec_plugin_summaries(
            &config,
            &path.to_string_lossy(),
            manager,
        ));
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
        exec_plugins,
    })
}

/// Read selected kubeconfig files in Rust, reject credentials that still live
/// in external files, and persist the merged YAML directly in the OS keyring.
/// The selected paths and YAML body never become a frontend payload.
pub fn import_local_kubeconfig(
    request: ImportLocalKubeconfigRequest,
    manager: &KubernetesManager,
    profiles: &crate::storage::ProfileRepository,
) -> AppResult<ImportLocalKubeconfigResult> {
    let paths = resolve_local_kubeconfig_paths(&request.paths)?;
    let mut merged: Option<Kubeconfig> = None;
    let mut display_names = Vec::new();
    for path in paths {
        let size = fs::metadata(&path)
            .map_err(|_| AppError::new("kubeconfig_read_error", "无法读取所选 kubeconfig。"))?
            .len();
        if size == 0 || size > IMPORTED_KUBECONFIG_MAX_BYTES as u64 {
            return Err(AppError::new(
                "kubernetes_import_size_invalid",
                "单个 kubeconfig 必须大于 0 且不超过 5 MB。",
            ));
        }
        let config = Kubeconfig::read_from(&path)
            .map_err(|_| AppError::new("kubeconfig_read_error", "所选 kubeconfig 无法解析。"))?;
        validate_importable_kubeconfig(&config)?;
        display_names.push(
            path.file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or("kubeconfig")
                .to_string(),
        );
        merged = Some(match merged {
            Some(existing) => Kubeconfig::merge(existing, config).map_err(|_| {
                AppError::new(
                    "kubernetes_import_invalid",
                    "多个 kubeconfig 无法安全合并。",
                )
            })?,
            None => config,
        });
    }
    let config = merged.ok_or_else(|| {
        AppError::new(
            "kubernetes_import_missing",
            "请选择至少一个 kubeconfig 文件。",
        )
    })?;
    let serialized = serde_yaml::to_string(&config)
        .map_err(|_| AppError::new("kubernetes_import_invalid", "无法安全序列化 kubeconfig。"))?;
    if serialized.len() > IMPORTED_KUBECONFIG_MAX_BYTES {
        return Err(AppError::new(
            "kubernetes_import_size_invalid",
            "合并后的 kubeconfig 超过 5 MB 上限。",
        ));
    }
    let content_fingerprint = format!("{:x}", Sha256::digest(serialized.as_bytes()));
    let secret_ref = if let Some(existing) =
        profiles.kubernetes_import_by_fingerprint(&content_fingerprint)?
    {
        // Reusing the same reference gives profiles imported from identical
        // content one secure-store item. Repair a missing OS credential entry
        // instead of creating a second reference.
        if manager.load_imported_kubeconfig(&existing).is_err() {
            manager.replace_imported_kubeconfig(&existing, serialized.as_bytes())?;
        }
        existing
    } else {
        let secret_ref = manager.store_imported_kubeconfig(serialized.as_bytes())?;
        if let Err(error) = profiles.register_kubernetes_import(&secret_ref, &content_fingerprint) {
            let _ = manager.delete_imported_kubeconfig(&secret_ref);
            return Err(error);
        }
        secret_ref
    };
    let source = KubernetesSource::LocalImported {
        secret_ref,
        display_names,
    };
    let scan = scan_imported_local_kubeconfig(&source, manager)?;
    Ok(ImportLocalKubeconfigResult { source, scan })
}

/// Scan a keyring-backed kubeconfig without exposing its content or original
/// file path. The opaque import id is used as the context source id.
pub fn scan_imported_local_kubeconfig(
    source: &KubernetesSource,
    manager: &KubernetesManager,
) -> AppResult<LocalKubeconfigScanResult> {
    let KubernetesSource::LocalImported {
        secret_ref,
        display_names,
    } = source
    else {
        return Err(AppError::new(
            "kubernetes_import_reference_invalid",
            "该 Kubernetes 来源不是已导入的 kubeconfig。",
        ));
    };
    let config = manager.load_imported_kubeconfig(secret_ref)?;
    let source_id = imported_source_id(secret_ref);
    let current_context = config.current_context.clone();
    let mut contexts = context_summaries(&config, &source_id);
    for context in &mut contexts {
        context.is_current = current_context.as_deref() == Some(context.name.as_str());
    }
    Ok(LocalKubeconfigScanResult {
        source_paths: display_names.clone(),
        contexts,
        current_context,
        exec_plugins: exec_plugin_summaries(&config, &source_id, manager),
    })
}

fn validate_importable_kubeconfig(config: &Kubeconfig) -> AppResult<()> {
    let has_external_cluster_file = config.clusters.iter().any(|cluster| {
        cluster
            .cluster
            .as_ref()
            .and_then(|cluster| cluster.certificate_authority.as_ref())
            .is_some()
    });
    let has_external_credential_file = config.auth_infos.iter().any(|auth| {
        auth.auth_info.as_ref().is_some_and(|auth| {
            auth.token_file.is_some()
                || auth.client_certificate.is_some()
                || auth.client_key.is_some()
        })
    });
    if has_external_cluster_file || has_external_credential_file {
        return Err(AppError::new(
            "kubernetes_import_external_reference",
            "导入的 kubeconfig 含外部证书、私钥或 Token 文件引用。请改用嵌入凭据的配置，或使用“路径引用”模式。",
        ));
    }
    Ok(())
}

/// Persist or revoke an approval for the exact, non-secret plugin fingerprint
/// returned from [`scan_local_kubeconfig`]. A forged value cannot approve a
/// different plugin because the fingerprint is recomputed before every use.
pub fn set_local_exec_plugin_trust(
    request: KubernetesExecPluginTrustRequest,
    manager: &KubernetesManager,
) -> AppResult<()> {
    if request.fingerprint.len() != 64
        || !request
            .fingerprint
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::new(
            "kubernetes_exec_plugin_invalid",
            "认证插件标识无效，请重新扫描 kubeconfig。",
        ));
    }
    manager.set_exec_plugin_trusted(&request.fingerprint, request.trusted)
}

/// Tests each selected context independently. Failures are returned per
/// context, rather than aborting the profile editor and hiding other usable
/// contexts. The result contains only identity and permission metadata.
pub async fn test_connection(
    request: KubernetesConnectionTestRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<Vec<KubernetesConnectionTestResult>> {
    if request.contexts.is_empty() {
        return Err(AppError::new(
            "kubernetes_context_missing",
            "请先发现并选择至少一个 Kubernetes context。",
        ));
    }
    let mut results = Vec::with_capacity(request.contexts.len());
    for context in request.contexts {
        let (capability_result, version) = match &request.source {
            KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
                let source = local_kubeconfig_source(&request.source).expect("local source");
                let backend = LocalKubernetesBackend { source, manager };
                let version = match manager.local_client(source, &context).await {
                    Ok(client) => client
                        .apiserver_version()
                        .await
                        .ok()
                        .map(|info| info.git_version),
                    Err(_) => None,
                };
                (backend.capabilities(&context).await, version)
            }
            KubernetesSource::RemoteSsh {
                ssh_profile_id,
                kubeconfig_path,
                kubectl_path,
            } => {
                match remote_backend(
                    ssh_profile_id,
                    kubeconfig_path.as_deref(),
                    kubectl_path.as_deref(),
                    ssh_profiles,
                    pool,
                ) {
                    Ok(backend) => {
                        let version = discover_remote_kubectl_version(
                            &backend.ssh_profile,
                            backend.kubectl_path.unwrap_or("kubectl"),
                            pool,
                        )
                        .await
                        .ok()
                        .flatten();
                        (backend.capabilities(&context).await, version)
                    }
                    Err(error) => (Err(error), None),
                }
            }
        };
        match capability_result {
            Ok(capabilities) => results.push(KubernetesConnectionTestResult {
                context,
                success: true,
                source: capabilities.source,
                version,
                username: capabilities.username,
                can_list_pods: capabilities.can_list_pods,
                can_get_pods: capabilities.can_get_pods,
                message: None,
            }),
            Err(error) => results.push(KubernetesConnectionTestResult {
                context,
                success: false,
                source: match &request.source {
                    KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
                        "localApi".to_string()
                    }
                    KubernetesSource::RemoteSsh { .. } => "remoteKubectl".to_string(),
                },
                version,
                username: None,
                can_list_pods: None,
                can_get_pods: None,
                message: Some(error.message),
            }),
        }
    }
    Ok(results)
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
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .list(&query)
            .await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .list(&query)
            .await?
        }
    };
    resource_list_from_value(value, &query)
}

/// Parses every YAML document before any write-capable endpoint is contacted.
/// This boundary deliberately returns only resource identity, never Secret data.
pub fn parse_dry_run_manifests(
    request: &KubernetesDryRunRequest,
) -> AppResult<Vec<KubernetesManifestSummary>> {
    validate_resource_context(&request.context)?;
    parse_manifest_values(&request.yaml)?
        .iter()
        .map(manifest_summary)
        .collect::<AppResult<Vec<_>>>()
}

fn parse_manifest_values(yaml: &str) -> AppResult<Vec<serde_json::Value>> {
    if yaml.trim().is_empty() || yaml.len() > MANIFEST_MAX_BYTES {
        return Err(AppError::new(
            "kubernetes_manifest_size_invalid",
            "Kubernetes YAML 为空或超过 512 KB 上限。",
        ));
    }
    let mut manifests = Vec::new();
    for document in serde_yaml::Deserializer::from_str(yaml) {
        if manifests.len() >= MANIFEST_MAX_DOCUMENTS {
            return Err(AppError::new(
                "kubernetes_manifest_count_invalid",
                "一次最多提交 32 个 Kubernetes YAML 文档。",
            ));
        }
        let value = serde_yaml::Value::deserialize(document).map_err(|_| {
            AppError::new("kubernetes_manifest_invalid", "Kubernetes YAML 格式无效。")
        })?;
        if value.is_null() {
            continue;
        }
        let value = serde_json::to_value(value).map_err(|_| {
            AppError::new(
                "kubernetes_manifest_invalid",
                "Kubernetes YAML 无法转换为资源对象。",
            )
        })?;
        if !value.is_object() {
            return Err(AppError::new(
                "kubernetes_manifest_invalid",
                "Kubernetes YAML 文档必须是对象。",
            ));
        }
        // Validate identity at the boundary, before contacting the API.
        let _ = manifest_summary(&value)?;
        manifests.push(value);
    }
    if manifests.is_empty() {
        return Err(AppError::new(
            "kubernetes_manifest_invalid",
            "Kubernetes YAML 未包含资源对象。",
        ));
    }
    Ok(manifests)
}

fn manifest_summary(value: &serde_json::Value) -> AppResult<KubernetesManifestSummary> {
    let api_version = value
        .get("apiVersion")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_manifest_invalid",
                "Kubernetes YAML 缺少 apiVersion。",
            )
        })?;
    let kind = value
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new("kubernetes_manifest_invalid", "Kubernetes YAML 缺少 kind。")
        })?;
    let name = value
        .pointer("/metadata/name")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "kubernetes_manifest_invalid",
                "Kubernetes YAML 缺少 metadata.name。",
            )
        })?;
    Ok(KubernetesManifestSummary {
        api_version: api_version.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        namespace: value
            .pointer("/metadata/namespace")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

pub fn dry_run_preview(request: KubernetesDryRunRequest) -> AppResult<KubernetesDryRunResult> {
    let manifests = parse_dry_run_manifests(&request)?;
    Ok(KubernetesDryRunResult {
        message: "YAML 预解析通过；执行服务端 dry-run 前将逐资源显示确认。".to_string(),
        manifests,
    })
}

/// Execute Kubernetes' server-side validation/defaulting path without
/// persisting anything. The result is redacted before it crosses Tauri and is
/// suitable for showing as a confirmation preview.
pub async fn server_dry_run_apply(
    profile: KubernetesProfile,
    request: KubernetesApplyRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesApplyPreview> {
    validate_apply_request(&request)?;
    let values = parse_manifest_values(&request.yaml)?;
    let manifests = values
        .iter()
        .map(manifest_summary)
        .collect::<AppResult<Vec<_>>>()?;
    let objects = match &profile.source {
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .dry_run_apply(&request)
            .await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .dry_run_apply(&request)
            .await?
        }
    };
    let objects = values_to_documents(objects)?;
    let diff = render_apply_diff(&values, &objects);
    Ok(KubernetesApplyPreview {
        manifests,
        objects,
        diff,
        server_dry_run: true,
        message: "服务端 dry-run 通过；未写入集群。请确认默认字段、差异和权限后再应用。"
            .to_string(),
    })
}

pub async fn apply_resources(
    profile: KubernetesProfile,
    request: KubernetesApplyRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesApplyResult> {
    validate_apply_request(&request)?;
    // Enforce the server-side validation gate in the backend as well as in
    // the UI. Direct Tauri callers cannot bypass dry-run accidentally.
    server_dry_run_apply(
        profile.clone(),
        request.clone(),
        manager,
        ssh_profiles,
        pool,
    )
    .await?;
    let values = parse_manifest_values(&request.yaml)?;
    let manifests = values
        .iter()
        .map(manifest_summary)
        .collect::<AppResult<Vec<_>>>()?;
    let objects = match &profile.source {
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .apply(&request)
            .await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .apply(&request)
            .await?
        }
    };
    Ok(KubernetesApplyResult {
        manifests,
        objects: values_to_documents(objects)?,
        message: "Kubernetes 资源已应用。".to_string(),
    })
}

pub async fn delete_resources(
    profile: KubernetesProfile,
    request: KubernetesDeleteRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesDeleteResult> {
    validate_delete_request(&request)?;
    let dry_run_items = match &profile.source {
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .delete(&request, true)
            .await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .delete(&request, true)
            .await?
        }
    };
    if let Some(failure) = dry_run_items.iter().find(|item| !item.success) {
        return Err(AppError::new(
            "kubernetes_delete_dry_run_failed",
            failure
                .message
                .clone()
                .unwrap_or_else(|| format!("无法删除资源 {}。", failure.name)),
        ));
    }
    let items = match &profile.source {
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .delete(&request, false)
            .await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .delete(&request, false)
            .await?
        }
    };
    let failed = items.iter().filter(|item| !item.success).count();
    Ok(KubernetesDeleteResult {
        items,
        message: if failed == 0 {
            "资源删除请求已完成。".to_string()
        } else {
            format!("资源删除完成，但有 {failed} 项失败。")
        },
    })
}

fn validate_apply_request(request: &KubernetesApplyRequest) -> AppResult<()> {
    validate_resource_context(&request.context)?;
    validate_remote_value(&request.field_manager, "fieldManager")?;
    if request.field_manager.len() > 128 {
        return Err(AppError::new(
            "kubernetes_field_manager_invalid",
            "fieldManager 无效。",
        ));
    }
    Ok(())
}

fn validate_delete_request(request: &KubernetesDeleteRequest) -> AppResult<()> {
    validate_resource_context(&request.context)?;
    if request.names.is_empty() || request.names.len() > MANIFEST_MAX_DOCUMENTS {
        return Err(AppError::new(
            "kubernetes_delete_names_invalid",
            "一次最多删除 32 个资源。",
        ));
    }
    for name in &request.names {
        validate_remote_value(name, "资源名称")?;
    }
    validate_namespace(request.namespace.as_deref())?;
    if !matches!(
        request.propagation.as_str(),
        "foreground" | "background" | "orphan"
    ) {
        return Err(AppError::new(
            "kubernetes_delete_propagation_invalid",
            "删除传播策略无效。",
        ));
    }
    if let Some(version) = &request.resource_version {
        validate_remote_value(version, "resourceVersion")?;
    }
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
    Ok(())
}

fn values_to_documents(
    values: Vec<serde_json::Value>,
) -> AppResult<Vec<KubernetesResourceDocument>> {
    values
        .into_iter()
        .map(resource_document_from_value)
        .collect()
}

fn render_apply_diff(
    desired: &[serde_json::Value],
    server_objects: &[KubernetesResourceDocument],
) -> String {
    let mut output = String::new();
    for (index, desired_value) in desired.iter().enumerate() {
        let Some(server_object) = server_objects.get(index) else {
            continue;
        };
        if server_object.redacted {
            output.push_str(&format!(
                "{}：敏感字段已隐藏，无法显示内容差异。\n",
                server_object.item.name
            ));
            continue;
        }
        let desired_yaml = serde_yaml::to_string(desired_value).unwrap_or_default();
        if desired_yaml.trim() == server_object.yaml.trim() {
            output.push_str(&format!("{}：无结构差异。\n", server_object.item.name));
            continue;
        }
        output.push_str(&format!(
            "--- {}（目标）\n+++ {}（服务端 dry-run）\n",
            server_object.item.name, server_object.item.name
        ));
        let before = desired_yaml.lines().collect::<HashSet<_>>();
        for line in server_object.yaml.lines() {
            if !before.contains(line) {
                output.push('+');
                output.push_str(line);
                output.push('\n');
            }
        }
        for line in desired_yaml.lines() {
            if !server_object.yaml.lines().any(|current| current == line) {
                output.push('-');
                output.push_str(line);
                output.push('\n');
            }
        }
    }
    output
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
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .get(&request)
            .await?
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .get(&request)
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
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            let client = manager
                .local_client(
                    local_kubeconfig_source(&profile.source).expect("local source"),
                    &request.context,
                )
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
            KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
                follow_local_pod_logs(
                    &app_handle,
                    &task_operation_id,
                    local_kubeconfig_source(&profile.source).expect("local source"),
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

/// Starts an owned resource watch. The frontend supplies only structured query
/// fields; both local API and remote kubectl commands are constructed here.
pub async fn start_resource_watch(
    app_handle: AppHandle,
    profile: KubernetesProfile,
    request: KubernetesResourceWatchRequest,
    manager: KubernetesManager,
    ssh_profiles: crate::storage::ProfileRepository,
    pool: SshConnectionPool,
) -> AppResult<String> {
    validate_resource_query(&request.query)?;
    let operation_id = request
        .operation_id
        .as_ref()
        .filter(|value| is_valid_operation_id(value))
        .cloned()
        .unwrap_or_else(|| {
            format!(
                "kube-watch-{}",
                NEXT_LOG_OPERATION_ID.fetch_add(1, Ordering::Relaxed)
            )
        });
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    manager
        .resource_watch_operations
        .lock()
        .await
        .insert(operation_id.clone(), cancel_sender);
    let task_id = operation_id.clone();
    let query = request.query;
    let task_manager = manager.clone();
    tauri::async_runtime::spawn(async move {
        let result = match &profile.source {
            KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
                follow_local_resource_watch(
                    &app_handle,
                    &task_id,
                    local_kubeconfig_source(&profile.source).expect("local source"),
                    &query,
                    &task_manager,
                    cancel_receiver,
                )
                .await
            }
            KubernetesSource::RemoteSsh {
                ssh_profile_id,
                kubeconfig_path,
                kubectl_path,
            } => match ssh_profiles.get_profile(ssh_profile_id) {
                Ok(Some(ssh_profile)) => {
                    follow_remote_resource_watch(RemoteResourceWatchInput {
                        app_handle: &app_handle,
                        operation_id: &task_id,
                        profile: &ssh_profile,
                        kubeconfig_path: kubeconfig_path.as_deref(),
                        kubectl_path: kubectl_path.as_deref(),
                        query: &query,
                        pool: &pool,
                        cancelled: cancel_receiver,
                    })
                    .await
                }
                Ok(None) => Err(AppError::new(
                    "kubernetes_source_unavailable",
                    "Kubernetes 来源所选的 SSH 连接已不存在。",
                )),
                Err(error) => Err(error),
            },
        };
        if let Err(error) = result {
            emit_resource_watch_event(
                &app_handle,
                &task_id,
                "error",
                None,
                None,
                Some(error.message),
            );
        }
        task_manager
            .resource_watch_operations
            .lock()
            .await
            .remove(&task_id);
    });
    Ok(operation_id)
}

pub async fn cancel_resource_watch(manager: &KubernetesManager, operation_id: &str) {
    if let Some(sender) = manager
        .resource_watch_operations
        .lock()
        .await
        .remove(operation_id)
    {
        let _ = sender.send(true);
    }
}

/// Start a source-aware `kubectl port-forward` operation. The process/channel
/// is owned by the Kubernetes manager so closing a workspace or cancelling one
/// operation cannot affect SSH terminals, SFTP, or other Kubernetes tasks.
pub async fn start_port_forward(
    app_handle: AppHandle,
    profile: KubernetesProfile,
    request: KubernetesPortForwardRequest,
    manager: KubernetesManager,
    ssh_profiles: crate::storage::ProfileRepository,
    pool: SshConnectionPool,
) -> AppResult<KubernetesPortForwardInfo> {
    validate_port_forward_request(&request)?;
    let operation_id = request
        .operation_id
        .as_ref()
        .filter(|value| is_valid_operation_id(value))
        .cloned()
        .unwrap_or_else(|| {
            format!(
                "kube-port-forward-{}",
                NEXT_LOG_OPERATION_ID.fetch_add(1, Ordering::Relaxed)
            )
        });
    if manager
        .port_forward_infos
        .lock()
        .await
        .contains_key(&operation_id)
    {
        return Err(AppError::new(
            "kubernetes_port_forward_exists",
            "该 Kubernetes 端口转发任务已经存在。",
        ));
    }

    let namespace = request
        .namespace
        .clone()
        .or_else(|| request.context.namespace.clone())
        .filter(|value| !value.trim().is_empty());
    let (source, task) = match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => {
            let mut command =
                local_port_forward_command(kubeconfig_paths, &request, namespace.as_deref())?;
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let child = command.spawn().map_err(|error| {
                AppError::new(
                    "kubernetes_port_forward_start_failed",
                    format!("无法启动本机 kubectl port-forward：{error}"),
                )
            })?;
            (
                "localKubectl".to_string(),
                PortForwardTask::Local(Box::new(child)),
            )
        }
        KubernetesSource::LocalImported { .. } => {
            return Err(AppError::new(
                "kubernetes_imported_port_forward_unavailable",
                "安全导入的 kubeconfig 不会写入本机进程环境；请改用路径引用来源后再启动端口转发。",
            ));
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
            let command = remote_port_forward_command(
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                &request,
                namespace.as_deref(),
            )?;
            let transport = pool.acquire(ssh_profile, ChannelOwner::Exec).await?;
            let (channel, channel_lease) = transport.open_session_channel().await?;
            if channel.exec(true, command.as_bytes()).await.is_err() {
                transport.invalidate().await;
                return Err(crate::ssh::transport_recovering_error());
            }
            (
                "remoteKubectl".to_string(),
                PortForwardTask::Remote {
                    channel,
                    _channel_lease: channel_lease,
                },
            )
        }
    };

    let info = KubernetesPortForwardInfo {
        operation_id: operation_id.clone(),
        profile_id: request.profile_id,
        context: request.context.name,
        target_kind: request.target_kind,
        target_name: request.target_name,
        namespace,
        local_port: request.local_port,
        remote_port: request.remote_port,
        source,
        status: "running".to_string(),
    };
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    manager
        .port_forward_operations
        .lock()
        .await
        .insert(operation_id.clone(), cancel_sender);
    manager
        .port_forward_infos
        .lock()
        .await
        .insert(operation_id.clone(), info.clone());
    emit_port_forward_event(&app_handle, &operation_id, "started", None);

    let task_manager = manager.clone();
    let task_operation_id = operation_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_port_forward_task(task, cancel_receiver).await;
        let (event_type, message) = match result {
            PortForwardTaskResult::Completed => ("completed", None),
            PortForwardTaskResult::Cancelled => ("cancelled", None),
            PortForwardTaskResult::Failed(message) => ("error", Some(message)),
        };
        emit_port_forward_event(&app_handle, &task_operation_id, event_type, message);
        task_manager
            .port_forward_operations
            .lock()
            .await
            .remove(&task_operation_id);
        task_manager
            .port_forward_infos
            .lock()
            .await
            .remove(&task_operation_id);
    });
    Ok(info)
}

pub async fn cancel_port_forward(manager: &KubernetesManager, operation_id: &str) {
    if let Some(sender) = manager
        .port_forward_operations
        .lock()
        .await
        .remove(operation_id)
    {
        let _ = sender.send(true);
    }
}

pub async fn list_port_forwards(manager: &KubernetesManager) -> Vec<KubernetesPortForwardInfo> {
    manager
        .port_forward_infos
        .lock()
        .await
        .values()
        .cloned()
        .collect()
}

enum PortForwardTask {
    Local(Box<tokio::process::Child>),
    Remote {
        channel: russh::Channel<russh::client::Msg>,
        _channel_lease: crate::ssh::ChannelLease,
    },
}

enum PortForwardTaskResult {
    Completed,
    Cancelled,
    Failed(String),
}

async fn run_port_forward_task(
    task: PortForwardTask,
    mut cancelled: watch::Receiver<bool>,
) -> PortForwardTaskResult {
    match task {
        PortForwardTask::Local(mut child) => {
            tokio::select! {
                changed = cancelled.changed() => {
                    if changed.is_ok() && *cancelled.borrow() {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        PortForwardTaskResult::Cancelled
                    } else {
                        PortForwardTaskResult::Failed("端口转发取消通道已断开。".to_string())
                    }
                }
                result = child.wait() => match result {
                    Ok(status) if status.success() => PortForwardTaskResult::Completed,
                    Ok(status) => PortForwardTaskResult::Failed(format!("kubectl port-forward 已退出（退出码 {}）。", status.code().unwrap_or(-1))),
                    Err(error) => PortForwardTaskResult::Failed(format!("读取 kubectl port-forward 状态失败：{error}")),
                }
            }
        }
        PortForwardTask::Remote { mut channel, .. } => loop {
            tokio::select! {
                changed = cancelled.changed() => {
                    if changed.is_ok() && *cancelled.borrow() {
                        let _ = channel.close().await;
                        return PortForwardTaskResult::Cancelled;
                    }
                    return PortForwardTaskResult::Failed("端口转发取消通道已断开。".to_string());
                }
                message = channel.wait() => match message {
                        Some(ChannelMsg::ExitStatus { exit_status: 0 }) => return PortForwardTaskResult::Completed,
                    Some(ChannelMsg::ExitStatus { exit_status }) => return PortForwardTaskResult::Failed(format!("远端 kubectl port-forward 已退出（退出码 {exit_status}）。")),
                        // kubectl writes both the successful "Forwarding from …"
                        // line and failures to stderr. Wait for the exit status
                        // instead of treating normal startup diagnostics as an
                        // error.
                        Some(ChannelMsg::ExtendedData { .. }) => {}
                    Some(ChannelMsg::Close) | None => return PortForwardTaskResult::Completed,
                    _ => {}
                }
            }
        },
    }
}

fn emit_port_forward_event(
    app_handle: &AppHandle,
    operation_id: &str,
    event_type: &str,
    message: Option<String>,
) {
    let _ = app_handle.emit(
        PORT_FORWARD_EVENT,
        KubernetesPortForwardEvent {
            operation_id: operation_id.to_string(),
            event_type: event_type.to_string(),
            message,
        },
    );
}

fn validate_port_forward_request(request: &KubernetesPortForwardRequest) -> AppResult<()> {
    validate_resource_context(&request.context)?;
    if !matches!(request.target_kind.as_str(), "pod" | "service") {
        return Err(AppError::new(
            "kubernetes_port_forward_target_invalid",
            "端口转发目标只能是 Pod 或 Service。",
        ));
    }
    validate_remote_value(&request.target_name, "端口转发目标")?;
    validate_namespace(request.namespace.as_deref())?;
    if request.local_port == 0 || request.remote_port == 0 {
        return Err(AppError::new(
            "kubernetes_port_forward_port_invalid",
            "本地端口和目标端口必须在 1 到 65535 之间。",
        ));
    }
    std::net::TcpListener::bind(("127.0.0.1", request.local_port)).map_err(|error| {
        AppError::new(
            "kubernetes_port_forward_port_busy",
            format!("本地端口 {} 不可用：{error}", request.local_port),
        )
    })?;
    Ok(())
}

fn local_port_forward_command(
    paths: &[String],
    request: &KubernetesPortForwardRequest,
    namespace: Option<&str>,
) -> AppResult<tokio::process::Command> {
    let mut command = tokio::process::Command::new("kubectl");
    if !paths.is_empty() {
        let separator = if cfg!(windows) { ";" } else { ":" };
        let values = paths
            .iter()
            .filter(|path| !path.trim().is_empty())
            .map(|path| expand_local_path(path.trim()).to_string_lossy().to_string())
            .collect::<Vec<_>>();
        if !values.is_empty() {
            command.env("KUBECONFIG", values.join(separator));
        }
    }
    let target = format!("{}/{}", request.target_kind, request.target_name);
    command.args(["--context", request.context.name.as_str()]);
    if let Some(namespace) = namespace {
        command.args(["--namespace", namespace]);
    }
    command.args(["port-forward", "--address", "127.0.0.1", target.as_str()]);
    command.arg(format!("{}:{}", request.local_port, request.remote_port));
    Ok(command)
}

/// Remote discovery stores the kubeconfig path in each context's source id.
/// When the profile leaves the path blank (automatic discovery), reuse that
/// source id for subsequent kubectl operations instead of falling back to the
/// remote user's default kubeconfig.
fn remote_source_kubeconfig_path<'a>(
    configured: Option<&'a str>,
    context: &'a KubernetesContextSelection,
) -> Option<&'a str> {
    configured
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!context.source_id.trim().is_empty()).then_some(context.source_id.as_str()))
}

fn remote_port_forward_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesPortForwardRequest,
    namespace: Option<&str>,
) -> AppResult<String> {
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &request.context);
    let mut args = vec![shell_quote(kubectl_path.unwrap_or("kubectl"))?];
    args.push(format!("--context {}", shell_quote(&request.context.name)?));
    if let Some(path) = kubeconfig_path.filter(|value| !value.trim().is_empty()) {
        args.push(format!("--kubeconfig {}", shell_quote(path)?));
    }
    if let Some(namespace) = namespace {
        args.push(format!("--namespace {}", shell_quote(namespace)?));
    }
    args.push("port-forward".to_string());
    args.push("--address 127.0.0.1".to_string());
    args.push(shell_quote(&format!(
        "{}/{}",
        request.target_kind, request.target_name
    ))?);
    args.push(shell_quote(&format!(
        "{}:{}",
        request.local_port, request.remote_port
    ))?);
    Ok(args.join(" "))
}

async fn follow_local_resource_watch(
    app_handle: &AppHandle,
    operation_id: &str,
    source: LocalKubeconfigSource<'_>,
    query: &KubernetesResourceQuery,
    manager: &KubernetesManager,
    mut cancelled: watch::Receiver<bool>,
) -> AppResult<()> {
    let client = manager.local_client(source, &query.context).await?;
    let api = dynamic_api(client, query, query.namespace.as_deref())?;
    let mut params = WatchParams::default().timeout(280);
    if let Some(selector) = query
        .label_selector
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        params = params.labels(selector);
    }
    let mut resource_version = "0".to_string();
    loop {
        if *cancelled.borrow() {
            emit_resource_watch_event(app_handle, operation_id, "cancelled", None, None, None);
            return Ok(());
        }
        let stream = api
            .watch(&params, &resource_version)
            .await
            .map_err(|error| {
                AppError::new(
                    "kubernetes_watch_failed",
                    format!("启动 Kubernetes Watch 失败：{error}"),
                )
            })?;
        futures::pin_mut!(stream);
        loop {
            tokio::select! {
                changed = cancelled.changed() => {
                    if changed.is_ok() && *cancelled.borrow() {
                        emit_resource_watch_event(app_handle, operation_id, "cancelled", None, None, None);
                        return Ok(());
                    }
                }
                event = stream.next() => match event {
                    Some(Ok(WatchEvent::Added(object))) => emit_local_watch_item(app_handle, operation_id, "added", object, &mut resource_version)?,
                    Some(Ok(WatchEvent::Modified(object))) => emit_local_watch_item(app_handle, operation_id, "modified", object, &mut resource_version)?,
                    Some(Ok(WatchEvent::Deleted(object))) => emit_local_watch_item(app_handle, operation_id, "deleted", object, &mut resource_version)?,
                    Some(Ok(WatchEvent::Bookmark(bookmark))) => { resource_version = bookmark.metadata.resource_version; emit_resource_watch_event(app_handle, operation_id, "bookmark", None, Some(resource_version.clone()), None); }
                    Some(Ok(WatchEvent::Error(status))) => {
                        if status.code == 410 { resource_version = "0".to_string(); emit_resource_watch_event(app_handle, operation_id, "reset", None, None, Some("资源版本已过期，正在重新同步。".to_string())); break; }
                        return Err(AppError::new("kubernetes_watch_event_failed", "Kubernetes Watch 被服务器拒绝。"));
                    }
                    Some(Err(_)) => return Err(AppError::new("kubernetes_watch_stream_failed", "Kubernetes Watch 流中断。")),
                    None => break,
                }
            }
        }
        emit_resource_watch_event(
            app_handle,
            operation_id,
            "reconnecting",
            None,
            Some(resource_version.clone()),
            None,
        );
    }
}

fn emit_local_watch_item(
    app_handle: &AppHandle,
    operation_id: &str,
    event_type: &str,
    object: DynamicObject,
    resource_version: &mut String,
) -> AppResult<()> {
    let value = serde_json::to_value(object)
        .map_err(|error| AppError::new("kubernetes_watch_decode", error.to_string()))?;
    let item = resource_item_from_value(value)?;
    if let Some(version) = item.resource_version.clone() {
        *resource_version = version;
    }
    emit_resource_watch_event(
        app_handle,
        operation_id,
        event_type,
        Some(item),
        Some(resource_version.clone()),
        None,
    );
    Ok(())
}

struct RemoteResourceWatchInput<'a> {
    app_handle: &'a AppHandle,
    operation_id: &'a str,
    profile: &'a SshProfile,
    kubeconfig_path: Option<&'a str>,
    kubectl_path: Option<&'a str>,
    query: &'a KubernetesResourceQuery,
    pool: &'a SshConnectionPool,
    cancelled: watch::Receiver<bool>,
}

async fn follow_remote_resource_watch(input: RemoteResourceWatchInput<'_>) -> AppResult<()> {
    let RemoteResourceWatchInput {
        app_handle,
        operation_id,
        profile,
        kubeconfig_path,
        kubectl_path,
        query,
        pool,
        mut cancelled,
    } = input;
    let command = format!(
        "{} --watch --request-timeout=280s",
        remote_kubectl_command(kubeconfig_path, kubectl_path, query, None)?
    );
    let transport = pool.acquire(profile.clone(), ChannelOwner::Exec).await?;
    let (mut channel, _lease) = transport.open_session_channel().await?;
    if channel.exec(true, command.as_bytes()).await.is_err() {
        transport.invalidate().await;
        return Err(crate::ssh::transport_recovering_error());
    }
    let mut pending = String::new();
    loop {
        tokio::select! {
            changed = cancelled.changed() => {
                if changed.is_ok() && *cancelled.borrow() {
                    let _ = channel.close().await;
                    emit_resource_watch_event(app_handle, operation_id, "cancelled", None, None, None);
                    return Ok(());
                }
            }
            message = channel.wait() => match message {
                Some(ChannelMsg::Data { data }) => {
                    pending.push_str(&String::from_utf8_lossy(&data));
                    while let Some(index) = pending.find('\n') {
                        let line = pending.drain(..=index).collect::<String>();
                        emit_remote_watch_line(app_handle, operation_id, line.trim())?;
                    }
                    if pending.len() > RESOURCE_MAX_OUTPUT_BYTES { let _ = channel.close().await; return Err(AppError::new("remote_kubernetes_watch_limit", "远端 Kubernetes Watch 单条输出超过安全上限。")); }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let text = String::from_utf8_lossy(&data);
                    if !text.trim().is_empty() { emit_resource_watch_event(app_handle, operation_id, "error", None, None, Some("远端 kubectl Watch 输出错误。".to_string())); }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) if exit_status != 0 => return Err(AppError::new("remote_kubernetes_watch_failed", format!("远端 kubectl Watch 已退出（退出码 {exit_status}）。"))),
                Some(ChannelMsg::Close) | None => { emit_resource_watch_event(app_handle, operation_id, "reconnecting", None, None, None); return Ok(()); }
                _ => {}
            }
        }
    }
}

fn emit_remote_watch_line(app_handle: &AppHandle, operation_id: &str, line: &str) -> AppResult<()> {
    if line.is_empty() {
        return Ok(());
    }
    let value: serde_json::Value = serde_json::from_str(line).map_err(|_| {
        AppError::new(
            "remote_kubernetes_watch_json",
            "远端 kubectl Watch 返回了无效 JSON。",
        )
    })?;
    let event_type = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    match event_type {
        "ADDED" | "MODIFIED" | "DELETED" => {
            let object = value.get("object").cloned().ok_or_else(|| {
                AppError::new(
                    "remote_kubernetes_watch_json",
                    "远端 Watch 事件缺少资源对象。",
                )
            })?;
            let item = resource_item_from_value(object)?;
            let kind = match event_type {
                "ADDED" => "added",
                "MODIFIED" => "modified",
                _ => "deleted",
            };
            emit_resource_watch_event(
                app_handle,
                operation_id,
                kind,
                Some(item.clone()),
                item.resource_version,
                None,
            );
        }
        "BOOKMARK" => emit_resource_watch_event(
            app_handle,
            operation_id,
            "bookmark",
            None,
            value
                .pointer("/object/metadata/resourceVersion")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            None,
        ),
        "ERROR" => emit_resource_watch_event(
            app_handle,
            operation_id,
            if value
                .pointer("/object/code")
                .and_then(serde_json::Value::as_u64)
                == Some(410)
            {
                "reset"
            } else {
                "error"
            },
            None,
            None,
            Some("远端 Kubernetes Watch 被服务器拒绝。".to_string()),
        ),
        _ => {}
    }
    Ok(())
}

fn emit_resource_watch_event(
    app_handle: &AppHandle,
    operation_id: &str,
    event_type: &str,
    item: Option<KubernetesResourceItem>,
    resource_version: Option<String>,
    message: Option<String>,
) {
    let _ = app_handle.emit(
        RESOURCE_WATCH_EVENT,
        KubernetesResourceWatchEvent {
            operation_id: operation_id.to_string(),
            event_type: event_type.to_string(),
            item,
            resource_version,
            message,
        },
    );
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
        KubernetesSource::LocalImported { .. } => {
            return Err(AppError::new(
                "kubernetes_imported_cli_unavailable",
                "已导入的 kubeconfig 仅保存在系统凭据存储中，不能安全写入终端环境。请改用路径引用后再打开 CLI。",
            ));
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
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            LocalKubernetesBackend {
                source: local_kubeconfig_source(&profile.source).expect("local source"),
                manager,
            }
            .capabilities(&request.context)
            .await
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            remote_backend(
                ssh_profile_id,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                ssh_profiles,
                pool,
            )?
            .capabilities(&request.context)
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
    let permissions = local_permission_matrix(client, &resources).await;
    let can_list_pods = permission_allowed(&permissions, "pods", "list");
    let can_get_pods = permission_allowed(&permissions, "pods", "get");
    let can_create_pods = permission_allowed(&permissions, "pods", "create");
    Ok(KubernetesCapabilities {
        resources,
        can_list_pods,
        can_get_pods,
        can_create_pods,
        permissions,
        source: "localApi".to_string(),
        username,
    })
}

fn permission_allowed(
    permissions: &[KubernetesPermissionCheck],
    resource: &str,
    verb: &str,
) -> Option<bool> {
    permissions
        .iter()
        .find(|check| check.resource == resource && check.verb == verb)
        .and_then(|check| match check.status.as_str() {
            "allowed" => Some(true),
            "denied" => Some(false),
            _ => None,
        })
}

fn permission_check(
    probe: PermissionProbe,
    status: &str,
    message: Option<&str>,
) -> KubernetesPermissionCheck {
    KubernetesPermissionCheck {
        resource: probe.resource.to_string(),
        api_group: probe.api_group.to_string(),
        verb: probe.verb.to_string(),
        namespaced: probe.namespaced,
        status: status.to_string(),
        message: message.map(str::to_string),
    }
}

fn resource_is_discovered(
    probe: PermissionProbe,
    resources: &[crate::models::kubernetes::KubernetesResourceType],
) -> bool {
    let expected_api_prefix = if probe.api_group.is_empty() {
        ""
    } else {
        probe.api_group
    };
    let parent_resource = probe.resource.split('/').next().unwrap_or(probe.resource);
    resources.iter().any(|resource| {
        resource.name == parent_resource
            && (expected_api_prefix.is_empty()
                || resource.api_version == expected_api_prefix
                || resource
                    .api_version
                    .strip_prefix(expected_api_prefix)
                    .is_some_and(|suffix| suffix.starts_with('/')))
    })
}

async fn local_permission_matrix(
    client: Client,
    resources: &[crate::models::kubernetes::KubernetesResourceType],
) -> Vec<KubernetesPermissionCheck> {
    stream::iter(WORKSPACE_PERMISSION_PROBES.iter().copied())
        .map(|probe| {
            let client = client.clone();
            async move {
                if !resource_is_discovered(probe, resources) {
                    return permission_check(probe, "unsupported", Some("API 未发现该资源。"));
                }
                local_permission_check(client, probe).await
            }
        })
        .buffer_unordered(4)
        .collect()
        .await
}

async fn local_permission_check(
    client: Client,
    probe: PermissionProbe,
) -> KubernetesPermissionCheck {
    let ar = ApiResource::from_gvk_with_plural(
        &GroupVersionKind::gvk("authorization.k8s.io", "v1", "SelfSubjectAccessReview"),
        "selfsubjectaccessreviews",
    );
    let api: Api<DynamicObject> = Api::all_with(client, &ar);
    let (resource, subresource) = probe
        .resource
        .split_once('/')
        .map_or((probe.resource, None), |(resource, subresource)| {
            (resource, Some(subresource))
        });
    let body = DynamicObject::new("", &ar).data(serde_json::json!({
        "spec": {
            "resourceAttributes": {
                "group": probe.api_group,
                "verb": probe.verb,
                "resource": resource,
                "subresource": subresource,
            }
        }
    }));
    match api.create(&PostParams::default(), &body).await {
        Ok(review) => match review
            .data
            .pointer("/status/allowed")
            .and_then(serde_json::Value::as_bool)
        {
            Some(true) => permission_check(probe, "allowed", None),
            Some(false) => permission_check(probe, "denied", None),
            None => permission_check(probe, "error", Some("权限检查未返回结果。")),
        },
        Err(kube::Error::Api(response)) if matches!(response.code, 404 | 405) => {
            permission_check(probe, "unsupported", Some("集群不支持权限检查 API。"))
        }
        Err(_) => permission_check(probe, "error", Some("无法完成权限检查。")),
    }
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
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, context);
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
    let resources_available =
        resources_output.exit_code == Some(0) && !resources_output.output_truncated;
    let resources = if resources_available {
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
    let permissions =
        remote_permission_matrix(profile, &base, &resources, resources_available, pool).await;
    let can_list_pods = permission_allowed(&permissions, "pods", "list");
    let can_get_pods = permission_allowed(&permissions, "pods", "get");
    let can_create_pods = permission_allowed(&permissions, "pods", "create");
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
        permissions,
        source: "remoteKubectl".to_string(),
        username,
    })
}

fn remote_resource_is_discovered(probe: PermissionProbe, resources: &[String]) -> bool {
    let resource = probe.resource.split('/').next().unwrap_or(probe.resource);
    let qualified = if probe.api_group.is_empty() {
        resource.to_string()
    } else {
        format!("{resource}.{}", probe.api_group)
    };
    resources.iter().any(|value| value == &qualified)
}

async fn remote_permission_matrix(
    profile: &SshProfile,
    base: &str,
    resources: &[String],
    resources_available: bool,
    pool: &SshConnectionPool,
) -> Vec<KubernetesPermissionCheck> {
    stream::iter(WORKSPACE_PERMISSION_PROBES.iter().copied())
        .map(|probe| async move {
            if !resources_available {
                return permission_check(probe, "error", Some("无法发现远端 API 资源。"));
            }
            if !remote_resource_is_discovered(probe, resources) {
                return permission_check(probe, "unsupported", Some("API 未发现该资源。"));
            }
            remote_permission_check(profile, base, probe, pool).await
        })
        .buffer_unordered(4)
        .collect()
        .await
}

async fn remote_permission_check(
    profile: &SshProfile,
    base: &str,
    probe: PermissionProbe,
    pool: &SshConnectionPool,
) -> KubernetesPermissionCheck {
    let namespace = probe.namespaced.then_some(" --all-namespaces");
    let output = run_ssh_command_with_limit(
        profile.clone(),
        format!(
            "{base} auth can-i {} {}{} --output=json",
            probe.verb,
            probe.resource,
            namespace.unwrap_or_default(),
        ),
        RESOURCE_TIMEOUT_SECS,
        VERSION_MAX_OUTPUT_BYTES,
        pool,
    )
    .await;
    let output = match output {
        Ok(output) => output,
        Err(_) => return permission_check(probe, "error", Some("无法完成权限检查。")),
    };
    if output.output_truncated {
        return permission_check(probe, "error", Some("权限检查输出超过安全上限。"));
    }
    if output.exit_code != Some(0) {
        let message = output.stderr.to_ascii_lowercase();
        if message.contains("the server doesn't have a resource type")
            || message.contains("could not find the requested resource")
        {
            return permission_check(probe, "unsupported", Some("集群不支持该资源或权限 API。"));
        }
        return permission_check(probe, "error", Some("无法完成权限检查。"));
    }
    match serde_json::from_str::<serde_json::Value>(&output.stdout)
        .ok()
        .and_then(|value| value.as_bool())
    {
        Some(true) => permission_check(probe, "allowed", None),
        Some(false) => permission_check(probe, "denied", None),
        None => permission_check(probe, "error", Some("权限检查未返回结果。")),
    }
}

async fn local_list_resources(
    source: LocalKubeconfigSource<'_>,
    query: &KubernetesResourceQuery,
    manager: &KubernetesManager,
) -> AppResult<serde_json::Value> {
    let client = manager.local_client(source, &query.context).await?;
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
    source: LocalKubeconfigSource<'_>,
    request: &KubernetesResourceDocumentRequest,
    manager: &KubernetesManager,
) -> AppResult<serde_json::Value> {
    let client = manager.local_client(source, &request.context).await?;
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

async fn local_apply_manifests(
    source: LocalKubeconfigSource<'_>,
    request: &KubernetesApplyRequest,
    manager: &KubernetesManager,
    dry_run: bool,
) -> AppResult<Vec<serde_json::Value>> {
    let client = manager.local_client(source, &request.context).await?;
    let values = parse_manifest_values(&request.yaml)?;
    let mut results = Vec::with_capacity(values.len());
    for value in values {
        let api = local_manifest_api(client.clone(), &value, request.context.namespace.as_deref())
            .await?;
        let name = manifest_summary(&value)?.name;
        let mut params = PatchParams::apply(&request.field_manager);
        params.dry_run = dry_run;
        params.force = request.force && !dry_run;
        let object = api
            .patch(&name, &params, &Patch::Apply(value))
            .await
            .map_err(|error| {
                AppError::new(
                    "kubernetes_apply_failed",
                    format!("Kubernetes 服务端 apply 失败：{error}"),
                )
            })?;
        results.push(
            serde_json::to_value(object).map_err(|error| {
                AppError::new("kubernetes_serialization_error", error.to_string())
            })?,
        );
    }
    Ok(results)
}

async fn local_delete_resources(
    source: LocalKubeconfigSource<'_>,
    request: &KubernetesDeleteRequest,
    manager: &KubernetesManager,
    dry_run: bool,
) -> AppResult<Vec<KubernetesDeleteItemResult>> {
    let client = manager.local_client(source, &request.context).await?;
    let mut query = KubernetesResourceQuery {
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
    let descriptor = resource_descriptor(&query)?;
    let api: Api<DynamicObject> = match (
        descriptor.namespaced,
        request
            .namespace
            .as_deref()
            .or(request.context.namespace.as_deref()),
    ) {
        (true, Some(namespace)) => {
            Api::namespaced_with(client, namespace, &descriptor.api_resource)
        }
        _ => Api::all_with(client, &descriptor.api_resource),
    };
    let mut params = match request.propagation.as_str() {
        "foreground" => DeleteParams::foreground(),
        "orphan" => DeleteParams::orphan(),
        _ => DeleteParams::background(),
    };
    if let Some(resource_version) = &request.resource_version {
        params.preconditions = Some(Preconditions {
            resource_version: Some(resource_version.clone()),
            ..Default::default()
        });
    }
    params.dry_run = dry_run;
    let mut results = Vec::with_capacity(request.names.len());
    for name in &request.names {
        let result = api.delete(name, &params).await;
        results.push(match result {
            Ok(_) => KubernetesDeleteItemResult {
                name: name.clone(),
                success: true,
                message: None,
            },
            Err(error) => KubernetesDeleteItemResult {
                name: name.clone(),
                success: false,
                message: Some(format!("删除失败：{error}")),
            },
        });
    }
    // Keep this assignment explicit so future query validation cannot silently
    // diverge from the descriptor selected above.
    query.resource = descriptor.plural;
    Ok(results)
}

async fn local_manifest_api(
    client: Client,
    value: &serde_json::Value,
    default_namespace: Option<&str>,
) -> AppResult<Api<DynamicObject>> {
    let summary = manifest_summary(value)?;
    let (api_resource, namespaced) = if let Some((group, version, kind, plural, namespaced)) =
        known_manifest_descriptor(&summary)
    {
        (
            ApiResource::from_gvk_with_plural(&GroupVersionKind::gvk(group, version, kind), plural),
            namespaced,
        )
    } else {
        let discovery = Discovery::new(client.clone())
            .run()
            .await
            .map_err(|error| {
                AppError::new(
                    "kubernetes_discovery_failed",
                    format!("无法发现资源 API：{error}"),
                )
            })?;
        let found = discovery
            .groups()
            .flat_map(|group| group.recommended_resources())
            .find(|(resource, _)| {
                resource.api_version == summary.api_version && resource.kind == summary.kind
            })
            .ok_or_else(|| {
                AppError::new(
                    "kubernetes_resource_unsupported",
                    format!("集群未发现 {} {}。", summary.api_version, summary.kind),
                )
            })?;
        let (resource, capabilities) = found;
        (resource.clone(), capabilities.scope == Scope::Namespaced)
    };
    let namespace = summary
        .namespace
        .as_deref()
        .or(default_namespace)
        .or(Some("default"));
    Ok(match (namespaced, namespace) {
        (true, Some(namespace)) => Api::namespaced_with(client, namespace, &api_resource),
        _ => Api::all_with(client, &api_resource),
    })
}

fn known_manifest_descriptor(
    summary: &KubernetesManifestSummary,
) -> Option<(&str, &str, &'static str, &'static str, bool)> {
    let (group, version) = summary
        .api_version
        .split_once('/')
        .unwrap_or(("", summary.api_version.as_str()));
    let known = match summary.kind.as_str() {
        "Pod" => ("Pod", "pods", true),
        "Service" => ("Service", "services", true),
        "Event" => ("Event", "events", true),
        "ConfigMap" => ("ConfigMap", "configmaps", true),
        "Secret" => ("Secret", "secrets", true),
        "Namespace" => ("Namespace", "namespaces", false),
        "Node" => ("Node", "nodes", false),
        "Deployment" => ("Deployment", "deployments", true),
        "StatefulSet" => ("StatefulSet", "statefulsets", true),
        "DaemonSet" => ("DaemonSet", "daemonsets", true),
        "ReplicaSet" => ("ReplicaSet", "replicasets", true),
        "Job" => ("Job", "jobs", true),
        "CronJob" => ("CronJob", "cronjobs", true),
        "Ingress" => ("Ingress", "ingresses", true),
        "PersistentVolumeClaim" => ("PersistentVolumeClaim", "persistentvolumeclaims", true),
        _ => return None,
    };
    (group.is_empty() || group == "apps" || group == "batch" || group == "networking.k8s.io")
        .then_some((group, version, known.0, known.1, known.2))
}

async fn remote_apply_manifests(
    profile: &SshProfile,
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesApplyRequest,
    pool: &SshConnectionPool,
    dry_run: bool,
) -> AppResult<Vec<serde_json::Value>> {
    let command = remote_apply_command(kubeconfig_path, kubectl_path, request, dry_run)?;
    let output = run_ssh_command_with_input(
        profile.clone(),
        command,
        request.yaml.as_bytes(),
        RESOURCE_TIMEOUT_SECS,
        RESOURCE_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if output.timed_out {
        return Err(AppError::new(
            "remote_kubernetes_timeout",
            "远端 Kubernetes apply 超时。",
        ));
    }
    if output.output_truncated {
        return Err(AppError::new(
            "remote_kubernetes_output_limit",
            "远端 Kubernetes apply 输出超过安全上限。",
        ));
    }
    if output.exit_code != Some(0) {
        return Err(AppError::new(
            "remote_kubernetes_apply_failed",
            command_failure_message(&output, "远端 Kubernetes apply 失败"),
        ));
    }
    let parsed = parse_yaml_documents(&output.stdout)?;
    if parsed.is_empty() {
        parse_manifest_values(&request.yaml)
    } else {
        Ok(parsed)
    }
}

fn remote_apply_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesApplyRequest,
    dry_run: bool,
) -> AppResult<String> {
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &request.context);
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut arguments = vec![
        executable,
        format!("--context {}", shell_quote(&request.context.name)?),
    ];
    if let Some(path) = kubeconfig_path.filter(|path| !path.trim().is_empty()) {
        arguments.push(format!("--kubeconfig {}", shell_quote(path)?));
    }
    if let Some(namespace) = request
        .context
        .namespace
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        arguments.push(format!("--namespace {}", shell_quote(namespace)?));
    }
    arguments.extend([
        "apply".to_string(),
        "--server-side".to_string(),
        format!("--field-manager {}", shell_quote(&request.field_manager)?),
    ]);
    if request.force && !dry_run {
        arguments.push("--force-conflicts".to_string());
    }
    if dry_run {
        arguments.push("--dry-run=server".to_string());
    }
    arguments.extend(["--filename -".to_string(), "--output yaml".to_string()]);
    Ok(arguments.join(" "))
}

async fn remote_delete_resources(
    profile: &SshProfile,
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesDeleteRequest,
    pool: &SshConnectionPool,
    dry_run: bool,
) -> AppResult<Vec<KubernetesDeleteItemResult>> {
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &request.context);
    let descriptor = resource_descriptor(&KubernetesResourceQuery {
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
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut results = Vec::with_capacity(request.names.len());
    for name in &request.names {
        let mut args = vec![
            executable.clone(),
            format!("--context {}", shell_quote(&request.context.name)?),
        ];
        if let Some(path) = kubeconfig_path.filter(|path| !path.trim().is_empty()) {
            args.push(format!("--kubeconfig {}", shell_quote(path)?));
        }
        args.push(format!(
            "delete {} {}",
            descriptor.plural,
            shell_quote(name)?
        ));
        if descriptor.namespaced
            && let Some(namespace) = request
                .namespace
                .as_deref()
                .or(request.context.namespace.as_deref())
                .filter(|value| !value.trim().is_empty())
        {
            args.push(format!("--namespace {}", shell_quote(namespace)?));
        }
        args.push(format!("--cascade={}", request.propagation));
        if let Some(version) = request.resource_version.as_deref() {
            args.push(format!("--resource-version {}", shell_quote(version)?));
        }
        if dry_run {
            args.push("--dry-run=server".to_string());
        }
        args.push("--ignore-not-found=false".to_string());
        let output = run_ssh_command_with_limit(
            profile.clone(),
            args.join(" "),
            RESOURCE_TIMEOUT_SECS,
            VERSION_MAX_OUTPUT_BYTES,
            pool,
        )
        .await;
        results.push(match output {
            Ok(output) if output.exit_code == Some(0) && !output.output_truncated => {
                KubernetesDeleteItemResult {
                    name: name.clone(),
                    success: true,
                    message: None,
                }
            }
            Ok(output) => KubernetesDeleteItemResult {
                name: name.clone(),
                success: false,
                message: Some(command_failure_message(&output, "远端 Kubernetes 删除失败")),
            },
            Err(error) => KubernetesDeleteItemResult {
                name: name.clone(),
                success: false,
                message: Some(error.message),
            },
        });
    }
    Ok(results)
}

fn parse_yaml_documents(raw: &str) -> AppResult<Vec<serde_json::Value>> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        if value
            .get("items")
            .and_then(serde_json::Value::as_array)
            .is_some()
        {
            return Ok(value
                .get("items")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default());
        }
        return Ok(vec![value]);
    }
    let mut values = Vec::new();
    for document in serde_yaml::Deserializer::from_str(raw) {
        let value = serde_yaml::Value::deserialize(document).map_err(|_| {
            AppError::new(
                "kubernetes_apply_output_invalid",
                "Kubernetes apply 返回的对象格式无效。",
            )
        })?;
        if value.is_null() {
            continue;
        }
        values.push(serde_json::to_value(value).map_err(|_| {
            AppError::new(
                "kubernetes_apply_output_invalid",
                "Kubernetes apply 返回的对象格式无效。",
            )
        })?);
    }
    Ok(values)
}

pub async fn scale_resource(
    profile: KubernetesProfile,
    request: KubernetesScaleRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesActionResult> {
    validate_action_identity(
        &request.context,
        &request.name,
        request.namespace.as_deref(),
    )?;
    if request.replicas > 100_000 {
        return Err(AppError::new(
            "kubernetes_replicas_invalid",
            "副本数必须在 0 到 100000 之间。",
        ));
    }
    let kind = request
        .kind
        .clone()
        .unwrap_or_else(|| match request.resource.as_str() {
            "statefulsets" => "StatefulSet".to_string(),
            "daemonsets" => "DaemonSet".to_string(),
            _ => "Deployment".to_string(),
        });
    let api_version = request
        .api_version
        .clone()
        .unwrap_or_else(|| "apps/v1".to_string());
    let yaml = serde_yaml::to_string(&serde_json::json!({
        "apiVersion": api_version,
        "kind": kind,
        "metadata": { "name": request.name.clone(), "namespace": request.namespace.clone() },
        "spec": { "replicas": request.replicas },
    }))
    .map_err(|error| AppError::new("kubernetes_action_invalid", error.to_string()))?;
    let apply_request = KubernetesApplyRequest {
        profile_id: request.profile_id,
        context: request.context,
        yaml,
        field_manager: request.field_manager,
        force: false,
    };
    let name = request.name.clone();
    let result = apply_resources(profile, apply_request, manager, ssh_profiles, pool).await?;
    Ok(KubernetesActionResult {
        name,
        action: "scale".to_string(),
        object: result.objects.into_iter().next(),
        message: format!("已将资源扩缩容至 {} 个副本。", request.replicas),
    })
}

pub async fn restart_rollout(
    profile: KubernetesProfile,
    request: KubernetesRolloutRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesActionResult> {
    validate_action_identity(
        &request.context,
        &request.name,
        request.namespace.as_deref(),
    )?;
    let kind = request
        .kind
        .clone()
        .unwrap_or_else(|| "Deployment".to_string());
    let api_version = request
        .api_version
        .clone()
        .unwrap_or_else(|| "apps/v1".to_string());
    let restarted_at = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let yaml = serde_yaml::to_string(&serde_json::json!({
        "apiVersion": api_version,
        "kind": kind,
        "metadata": { "name": request.name.clone(), "namespace": request.namespace.clone(), "annotations": { "kubectl.kubernetes.io/restartedAt": restarted_at } },
    })).map_err(|error| AppError::new("kubernetes_action_invalid", error.to_string()))?;
    let apply_request = KubernetesApplyRequest {
        profile_id: request.profile_id,
        context: request.context,
        yaml,
        field_manager: request.field_manager,
        force: false,
    };
    let name = request.name.clone();
    let result = apply_resources(profile, apply_request, manager, ssh_profiles, pool).await?;
    Ok(KubernetesActionResult {
        name,
        action: "rolloutRestart".to_string(),
        object: result.objects.into_iter().next(),
        message: "已请求滚动重启；请通过资源状态或 CLI 查看 rollout 进度。".to_string(),
    })
}

fn validate_action_identity(
    context: &KubernetesContextSelection,
    name: &str,
    namespace: Option<&str>,
) -> AppResult<()> {
    validate_resource_context(context)?;
    validate_remote_value(name, "资源名称")?;
    validate_namespace(namespace)
}

pub async fn pod_exec_launch(
    profile: &KubernetesProfile,
    request: KubernetesPodExecRequest,
    ssh_profiles: &crate::storage::ProfileRepository,
    _pool: &SshConnectionPool,
) -> AppResult<KubernetesExecLaunch> {
    validate_action_identity(&request.context, &request.pod, request.namespace.as_deref())?;
    if let Some(container) = request.container.as_deref() {
        validate_remote_value(container, "container 名称")?;
    }
    let command = if request.command.is_empty() {
        vec!["/bin/sh".to_string()]
    } else {
        request.command.clone()
    };
    if command.len() > 32 {
        return Err(AppError::new(
            "kubernetes_exec_command_invalid",
            "exec 命令参数过多。",
        ));
    }
    for value in &command {
        validate_remote_value(value, "exec 参数")?;
    }
    match &profile.source {
        KubernetesSource::Local { kubeconfig_paths } => Ok(KubernetesExecLaunch {
            command: local_pod_exec_command(kubeconfig_paths, &request, &command)?,
            ssh_profile_id: None,
            source_label: "本机 Kubernetes Exec".to_string(),
        }),
        KubernetesSource::LocalImported { .. } => Err(AppError::new(
            "kubernetes_imported_cli_disabled",
            "安全导入的 kubeconfig 不会写入终端环境；请改用路径引用后再执行 Pod Exec。",
        )),
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            if ssh_profiles.get_profile(ssh_profile_id)?.is_none() {
                return Err(AppError::new(
                    "profile_not_found",
                    "找不到 Kubernetes 来源所选的 SSH 连接。",
                ));
            }
            Ok(KubernetesExecLaunch {
                command: remote_pod_exec_command(
                    kubeconfig_path.as_deref(),
                    kubectl_path.as_deref(),
                    &request,
                    &command,
                )?,
                ssh_profile_id: Some(ssh_profile_id.clone()),
                source_label: "远端 Kubernetes Exec".to_string(),
            })
        }
    }
}

fn local_pod_exec_command(
    paths: &[String],
    request: &KubernetesPodExecRequest,
    command: &[String],
) -> AppResult<String> {
    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut prefix = "kubectl".to_string();
    let values = paths
        .iter()
        .filter(|value| !value.trim().is_empty())
        .map(|value| expand_local_path(value).to_string_lossy().to_string())
        .collect::<Vec<_>>();
    if !values.is_empty() {
        let value = values.join(separator);
        prefix = if cfg!(windows) {
            format!("$env:KUBECONFIG={}; kubectl", powershell_quote(&value))
        } else {
            format!("KUBECONFIG={} kubectl", shell_quote(&value)?)
        };
    }
    let quote = |value: &str| {
        if cfg!(windows) {
            Ok(powershell_quote(value))
        } else {
            shell_quote(value)
        }
    };
    let mut args = vec![format!("--context {}", quote(&request.context.name)?)];
    args.push(format!("exec {}", quote(&request.pod)?));
    args.push(if request.tty {
        "--stdin --tty".to_string()
    } else {
        "--stdin".to_string()
    });
    if let Some(namespace) = request
        .namespace
        .as_deref()
        .or(request.context.namespace.as_deref())
        .filter(|value| !value.trim().is_empty())
    {
        args.push(format!("--namespace {}", quote(namespace)?));
    }
    if let Some(container) = request
        .container
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.push(format!("--container {}", quote(container)?));
    }
    args.push("--".to_string());
    args.extend(
        command
            .iter()
            .map(|value| quote(value))
            .collect::<AppResult<Vec<_>>>()?,
    );
    Ok(format!("{prefix} {}", args.join(" ")))
}

fn remote_pod_exec_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesPodExecRequest,
    command: &[String],
) -> AppResult<String> {
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &request.context);
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut args = vec![
        executable,
        format!("--context {}", shell_quote(&request.context.name)?),
    ];
    if let Some(path) = kubeconfig_path.filter(|value| !value.trim().is_empty()) {
        args.push(format!("--kubeconfig {}", shell_quote(path)?));
    }
    args.push(format!("exec {}", shell_quote(&request.pod)?));
    args.push(if request.tty {
        "--stdin --tty".to_string()
    } else {
        "--stdin".to_string()
    });
    if let Some(namespace) = request
        .namespace
        .as_deref()
        .or(request.context.namespace.as_deref())
        .filter(|value| !value.trim().is_empty())
    {
        args.push(format!("--namespace {}", shell_quote(namespace)?));
    }
    if let Some(container) = request
        .container
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.push(format!("--container {}", shell_quote(container)?));
    }
    args.push("--".to_string());
    args.extend(
        command
            .iter()
            .map(|value| shell_quote(value))
            .collect::<AppResult<Vec<_>>>()?,
    );
    Ok(args.join(" "))
}

pub async fn metrics(
    profile: KubernetesProfile,
    request: KubernetesMetricsRequest,
    manager: &KubernetesManager,
    ssh_profiles: &crate::storage::ProfileRepository,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesMetricsResult> {
    validate_resource_context(&request.context)?;
    validate_namespace(request.namespace.as_deref())?;
    if let Some(pod) = request.pod.as_deref() {
        validate_remote_value(pod, "Pod 名称")?;
    }
    match &profile.source {
        KubernetesSource::Local { .. } | KubernetesSource::LocalImported { .. } => {
            let source = local_kubeconfig_source(&profile.source).expect("local source");
            let client = manager.local_client(source, &request.context).await?;
            local_metrics(client, &request).await
        }
        KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } => {
            let ssh_profile = ssh_profiles.get_profile(ssh_profile_id)?.ok_or_else(|| {
                AppError::new(
                    "profile_not_found",
                    "找不到 Kubernetes 来源所选的 SSH 连接。",
                )
            })?;
            remote_metrics(
                &ssh_profile,
                kubeconfig_path.as_deref(),
                kubectl_path.as_deref(),
                &request,
                pool,
            )
            .await
        }
    }
}

async fn local_metrics(
    client: Client,
    request: &KubernetesMetricsRequest,
) -> AppResult<KubernetesMetricsResult> {
    let ar = ApiResource::from_gvk_with_plural(
        &GroupVersionKind::gvk("metrics.k8s.io", "v1beta1", "PodMetrics"),
        "pods",
    );
    let api: Api<DynamicObject> = match request
        .namespace
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(namespace) => Api::namespaced_with(client, namespace, &ar),
        None => Api::all_with(client, &ar),
    };
    let values = match request.pod.as_deref() {
        Some(pod) => api
            .get(pod)
            .await
            .ok()
            .and_then(|object| serde_json::to_value(object).ok())
            .map(|object| vec![object])
            .unwrap_or_default(),
        None => api
            .list(&ListParams::default())
            .await
            .ok()
            .and_then(|list| serde_json::to_value(list).ok())
            .and_then(|value| {
                value
                    .get("items")
                    .and_then(serde_json::Value::as_array)
                    .cloned()
            })
            .unwrap_or_default(),
    };
    let items = values
        .iter()
        .filter_map(metric_item_from_value)
        .collect::<Vec<_>>();
    Ok(KubernetesMetricsResult {
        source: "localApi".to_string(),
        available: !items.is_empty(),
        items,
        message: if values.is_empty() {
            Some("Metrics API 不可用或当前没有指标。".to_string())
        } else {
            None
        },
    })
}

async fn remote_metrics(
    profile: &SshProfile,
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesMetricsRequest,
    pool: &SshConnectionPool,
) -> AppResult<KubernetesMetricsResult> {
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &request.context);
    let executable = shell_quote(kubectl_path.unwrap_or("kubectl"))?;
    let mut path = String::from("/apis/metrics.k8s.io/v1beta1/pods");
    if let Some(namespace) = request
        .namespace
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        path = format!("/apis/metrics.k8s.io/v1beta1/namespaces/{namespace}/pods");
    }
    if let Some(pod) = request.pod.as_deref() {
        path.push('/');
        path.push_str(pod);
    }
    let mut args = vec![
        executable,
        format!("--context {}", shell_quote(&request.context.name)?),
    ];
    if let Some(config) = kubeconfig_path.filter(|value| !value.trim().is_empty()) {
        args.push(format!("--kubeconfig {}", shell_quote(config)?));
    }
    args.push(format!("get --raw {}", shell_quote(&path)?));
    let output = run_ssh_command_with_limit(
        profile.clone(),
        args.join(" "),
        RESOURCE_TIMEOUT_SECS,
        RESOURCE_MAX_OUTPUT_BYTES,
        pool,
    )
    .await?;
    if output.exit_code != Some(0) || output.output_truncated {
        return Ok(KubernetesMetricsResult {
            source: "remoteKubectl".to_string(),
            available: false,
            items: Vec::new(),
            message: Some("远端 Metrics API 不可用。".to_string()),
        });
    }
    let value = serde_json::from_str::<serde_json::Value>(&output.stdout).unwrap_or_default();
    let values = value
        .get("items")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_else(|| {
            if value.is_object() {
                vec![value]
            } else {
                Vec::new()
            }
        });
    let items = values
        .iter()
        .filter_map(metric_item_from_value)
        .collect::<Vec<_>>();
    let available = !items.is_empty();
    Ok(KubernetesMetricsResult {
        source: "remoteKubectl".to_string(),
        available,
        items,
        message: if !available {
            Some("远端 Metrics API 没有返回指标。".to_string())
        } else {
            None
        },
    })
}

fn metric_item_from_value(
    value: &serde_json::Value,
) -> Option<crate::models::kubernetes::KubernetesMetricItem> {
    let metadata = value.get("metadata")?;
    let name = metadata.get("name")?.as_str()?.to_string();
    let namespace = metadata
        .get("namespace")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let mut cpu = 0u128;
    let mut memory = 0u128;
    if let Some(containers) = value
        .get("containers")
        .and_then(serde_json::Value::as_array)
    {
        for container in containers {
            if let Some(usage) = container.get("usage") {
                cpu = cpu.saturating_add(quantity_to_millis(
                    usage
                        .get("cpu")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default(),
                ));
                memory = memory.saturating_add(quantity_to_bytes(
                    usage
                        .get("memory")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default(),
                ));
            }
        }
    }
    Some(crate::models::kubernetes::KubernetesMetricItem {
        name,
        namespace,
        cpu: (cpu > 0).then(|| format!("{cpu}m")),
        memory: (memory > 0).then(|| format_bytes(memory)),
    })
}

fn quantity_to_millis(value: &str) -> u128 {
    if let Some(value) = value.strip_suffix('n') {
        return value.parse::<u128>().unwrap_or_default() / 1_000_000;
    }
    if let Some(value) = value.strip_suffix('u') {
        return value.parse::<u128>().unwrap_or_default() / 1_000;
    }
    if let Some(value) = value.strip_suffix('m') {
        return value.parse::<u128>().unwrap_or_default();
    }
    value
        .parse::<u128>()
        .unwrap_or_default()
        .saturating_mul(1000)
}

fn quantity_to_bytes(value: &str) -> u128 {
    let (number, multiplier) = if let Some(number) = value.strip_suffix("Ki") {
        (number, 1024u128)
    } else if let Some(number) = value.strip_suffix("Mi") {
        (number, 1024u128.pow(2))
    } else if let Some(number) = value.strip_suffix("Gi") {
        (number, 1024u128.pow(3))
    } else if let Some(number) = value.strip_suffix('K') {
        (number, 1000)
    } else if let Some(number) = value.strip_suffix('M') {
        (number, 1_000_000)
    } else if let Some(number) = value.strip_suffix('G') {
        (number, 1_000_000_000)
    } else {
        (value, 1)
    };
    number
        .parse::<u128>()
        .unwrap_or_default()
        .saturating_mul(multiplier)
}

fn format_bytes(value: u128) -> String {
    if value >= 1024u128.pow(3) {
        format!("{}Gi", value / 1024u128.pow(3))
    } else if value >= 1024u128.pow(2) {
        format!("{}Mi", value / 1024u128.pow(2))
    } else if value >= 1024 {
        format!("{}Ki", value / 1024)
    } else {
        format!("{value}B")
    }
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
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &query.context);
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
        if let Some(continue_token) = query
            .continue_token
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            arguments.push(format!("--continue {}", shell_quote(continue_token)?));
        }
    }
    arguments.push("--output=json".to_string());
    Ok(arguments.join(" "))
}

fn remote_logs_command(
    kubeconfig_path: Option<&str>,
    kubectl_path: Option<&str>,
    request: &KubernetesPodLogsRequest,
) -> AppResult<String> {
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, &request.context);
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
    let kubeconfig_path = remote_source_kubeconfig_path(kubeconfig_path, context);
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
    source: LocalKubeconfigSource<'_>,
    request: &KubernetesPodLogsRequest,
    manager: &KubernetesManager,
    mut cancelled: watch::Receiver<bool>,
) -> AppResult<()> {
    let client = manager.local_client(source, &request.context).await?;
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
    let labels = labels_from_value(metadata.get("labels"));
    let owners = metadata
        .get("ownerReferences")
        .and_then(serde_json::Value::as_array)
        .map(|references| {
            references
                .iter()
                .filter_map(|reference| {
                    let object = reference.as_object()?;
                    let api_version = object.get("apiVersion")?.as_str()?.trim();
                    let kind = object.get("kind")?.as_str()?.trim();
                    let name = object.get("name")?.as_str()?.trim();
                    if api_version.is_empty() || kind.is_empty() || name.is_empty() {
                        return None;
                    }
                    Some(KubernetesOwnerReference {
                        api_version: api_version.to_string(),
                        kind: kind.to_string(),
                        name: name.to_string(),
                        uid: object
                            .get("uid")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string),
                    })
                })
                .take(32)
                .collect()
        })
        .unwrap_or_default();
    let selector = value
        .pointer("/spec/selector/matchLabels")
        .map(|value| labels_from_value(Some(value)))
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
        owners,
        selector,
    })
}

fn labels_from_value(value: Option<&serde_json::Value>) -> Vec<KubernetesLabel> {
    value
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
                .take(128)
                .collect()
        })
        .unwrap_or_default()
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
            .flat_map(|path| {
                let parsed = std::env::split_paths(path.trim()).collect::<Vec<_>>();
                if parsed.is_empty() {
                    vec![PathBuf::from(path.trim())]
                } else {
                    parsed
                }
            })
            .map(|path| expand_local_path(&path.to_string_lossy()))
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

fn exec_plugin_summaries(
    config: &Kubeconfig,
    source_id: &str,
    manager: &KubernetesManager,
) -> Vec<KubernetesExecPluginSummary> {
    config
        .contexts
        .iter()
        .filter_map(|context| {
            let context_data = context.context.as_ref()?;
            let user = context_data.user.as_deref()?;
            let auth_info = config
                .auth_infos
                .iter()
                .find(|auth| auth.name == user)
                .and_then(|auth| auth.auth_info.as_ref())?;
            let exec = auth_info.exec.as_ref()?;
            let command = exec.command.as_deref()?.trim();
            if command.is_empty() {
                return None;
            }
            let arguments = exec.args.clone().unwrap_or_default();
            let fingerprint =
                exec_plugin_fingerprint(source_id, &context.name, user, command, &arguments);
            let mut environment_variable_names = exec
                .env
                .as_ref()
                .into_iter()
                .flatten()
                .filter_map(exec_environment_name)
                .collect::<Vec<_>>();
            environment_variable_names.sort();
            environment_variable_names.dedup();
            Some(KubernetesExecPluginSummary {
                fingerprint: fingerprint.clone(),
                source_id: source_id.to_string(),
                context_name: context.name.clone(),
                user: user.to_string(),
                command: command.to_string(),
                arguments_summary: exec_arguments_summary(&arguments),
                environment_variable_names,
                trusted: manager.is_exec_plugin_trusted(&fingerprint),
            })
        })
        .collect()
}

fn ensure_exec_plugin_trusted(
    config: &Kubeconfig,
    source_id: &str,
    context: &KubernetesContextSelection,
    manager: &KubernetesManager,
) -> AppResult<()> {
    let Some(plugin) = exec_plugin_summaries(config, source_id, manager)
        .into_iter()
        .find(|plugin| plugin.context_name == context.name)
    else {
        return Ok(());
    };
    if plugin.trusted {
        return Ok(());
    }
    Err(AppError::new(
        "kubernetes_exec_plugin_untrusted",
        format!(
            "context “{}” 使用认证插件 “{}”。请先在 Kubernetes 连接配置中检查并信任该插件。",
            plugin.context_name, plugin.command
        ),
    ))
}

fn exec_plugin_fingerprint(
    source_id: &str,
    context_name: &str,
    user: &str,
    command: &str,
    arguments: &[String],
) -> String {
    let mut hasher = Sha256::new();
    for segment in [source_id, context_name, user, command] {
        hasher.update(segment.as_bytes());
        hasher.update([0]);
    }
    for argument in arguments {
        hasher.update(argument.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn exec_arguments_summary(arguments: &[String]) -> String {
    if arguments.is_empty() {
        return "无参数".to_string();
    }
    let visible = arguments
        .iter()
        .filter(|argument| is_safe_exec_argument(argument))
        .take(3)
        .map(String::as_str)
        .collect::<Vec<_>>();
    if visible.is_empty() {
        format!("{} 个参数（内容已隐藏）", arguments.len())
    } else if visible.len() == arguments.len() {
        visible.join(" ")
    } else {
        format!(
            "{}（另有 {} 个参数已隐藏）",
            visible.join(" "),
            arguments.len() - visible.len()
        )
    }
}

fn is_safe_exec_argument(argument: &str) -> bool {
    let lower = argument.to_ascii_lowercase();
    argument.len() <= 120
        && !argument.contains('=')
        && !lower.contains("token")
        && !lower.contains("secret")
        && !lower.contains("password")
        && !lower.contains("private")
        && !lower.contains("credential")
}

fn valid_exec_environment_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn exec_environment_name(entry: &HashMap<String, String>) -> Option<String> {
    // Kubernetes uses `{ name, value }` entries. Support the map-shaped form
    // as well because kube's config parser accepts both representations.
    let name = entry.get("name").cloned().or_else(|| {
        (entry.len() == 1)
            .then(|| entry.keys().next().cloned())
            .flatten()
    })?;
    valid_exec_environment_name(&name).then_some(name)
}

fn sanitize_exec_plugin_environment(config: &mut Kubeconfig) {
    // kube's exec plugin runner inherits the application environment. Do not
    // also forward arbitrary values embedded in a kubeconfig. This allowlist
    // deliberately permits only common profile/location selectors, never
    // token-like environment variables.
    const ALLOWED: &[&str] = &[
        "AWS_PROFILE",
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
        "AZURE_CONFIG_DIR",
        "CLOUDSDK_CONFIG",
        "GOOGLE_APPLICATION_CREDENTIALS",
    ];
    for named in &mut config.auth_infos {
        let Some(exec) = named.auth_info.as_mut().and_then(|auth| auth.exec.as_mut()) else {
            continue;
        };
        if let Some(environment) = &mut exec.env {
            environment.retain(|entry| {
                exec_environment_name(entry)
                    .is_some_and(|name| ALLOWED.iter().any(|allowed| name == *allowed))
            });
        }
    }
}

fn kubeconfig_error_message(_error: &impl std::fmt::Display) -> &'static str {
    "认证配置无效、认证插件不可用或 API Server 拒绝了认证。"
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
    let status = match output.exit_code {
        Some(code) => format!("（退出码 {code}）"),
        None => String::new(),
    };
    let detail = sanitize_command_diagnostic(&output.stderr);
    if detail.is_empty() {
        format!("{action}{status}。")
    } else {
        format!("{action}{status}：{detail}")
    }
}

/// Keep remote command diagnostics useful without echoing an entire command
/// response (which may contain a large amount of unrelated output). Kubectl
/// writes actionable context/authentication/permission errors to stderr; this
/// is the only stream surfaced to the UI on a failed command.
fn sanitize_command_diagnostic(stderr: &str) -> String {
    const MAX_DIAGNOSTIC_CHARS: usize = 1_200;

    let mut detail = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !diagnostic_line_may_contain_secret(line))
        .collect::<Vec<_>>()
        .join(" ");
    detail.retain(|character| character != '\0' && !character.is_control());
    if detail.chars().count() > MAX_DIAGNOSTIC_CHARS {
        detail = detail.chars().take(MAX_DIAGNOSTIC_CHARS).collect();
        detail.push('…');
    }
    detail
}

fn diagnostic_line_may_contain_secret(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    [
        "token=",
        "password=",
        "passwd=",
        "secret=",
        "authorization:",
        "client-key-data",
        "client-certificate-data",
        "private key",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
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
        KubernetesManager, WORKSPACE_PERMISSION_PROBES, command_failure_message, context_summaries,
        ensure_exec_plugin_trusted, exec_plugin_summaries, parse_remote_context_rows,
        remote_cli_command, remote_kubectl_command, remote_resource_is_discovered, shell_quote,
        truncate_log, validate_importable_kubeconfig,
    };
    use crate::models::kubernetes::{
        KubernetesContextSelection, KubernetesResourceQuery, KubernetesSource,
    };
    use crate::ssh::command::CommandOutput;
    use kube::config::Kubeconfig;

    #[test]
    fn command_failure_message_includes_remote_stderr() {
        let message = command_failure_message(
            &CommandOutput {
                stdout: String::new(),
                stderr: "error: context \"staging\" does not exist\n\nadditional detail"
                    .to_string(),
                exit_code: Some(1),
                timed_out: false,
                output_truncated: false,
            },
            "远端 Kubernetes 查询失败",
        );
        assert_eq!(
            message,
            "远端 Kubernetes 查询失败（退出码 1）：error: context \"staging\" does not exist additional detail"
        );
    }

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
    fn source_payload_uses_camel_case_fields() {
        let source: KubernetesSource = serde_json::from_str(
            r#"{"kind":"remoteSsh","sshProfileId":"ssh-1","kubeconfigPath":"/srv/kubeconfig","kubectlPath":"/usr/local/bin/kubectl"}"#,
        )
        .expect("camelCase source parses");
        let KubernetesSource::RemoteSsh {
            ssh_profile_id,
            kubeconfig_path,
            kubectl_path,
        } = &source
        else {
            panic!("expected remote SSH source");
        };
        assert_eq!(ssh_profile_id, "ssh-1");
        assert_eq!(kubeconfig_path.as_deref(), Some("/srv/kubeconfig"));
        assert_eq!(kubectl_path.as_deref(), Some("/usr/local/bin/kubectl"));
        let serialized = serde_json::to_string(&source).expect("source serializes");
        assert!(serialized.contains("\"sshProfileId\""));
        assert!(!serialized.contains("ssh_profile_id"));
        let legacy: KubernetesSource =
            serde_json::from_str(r#"{"kind":"remoteSsh","ssh_profile_id":"ssh-legacy"}"#)
                .expect("legacy snake_case source remains readable");
        assert!(
            matches!(legacy, KubernetesSource::RemoteSsh { ssh_profile_id, .. } if ssh_profile_id == "ssh-legacy")
        );
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
                user: None,
            },
        )
        .expect("command builds");
        assert!(command.contains("--context 'prod; echo unsafe'"));
        assert!(command.contains("--kubeconfig '/srv/kube config'"));
        assert!(command.contains("--namespace 'team a'"));
    }

    #[test]
    fn remote_list_command_passes_quoted_continue_token() {
        let command = remote_kubectl_command(
            Some("/srv/kubeconfig"),
            Some("kubectl"),
            &KubernetesResourceQuery {
                profile_id: "profile".to_string(),
                context: KubernetesContextSelection {
                    source_id: "/srv/kubeconfig".to_string(),
                    name: "prod".to_string(),
                    namespace: Some("default".to_string()),
                    user: None,
                },
                resource: "pods".to_string(),
                api_version: None,
                kind: None,
                namespaced: Some(true),
                namespace: Some("default".to_string()),
                label_selector: None,
                limit: 100,
                continue_token: Some("next; unsafe".to_string()),
            },
            None,
        )
        .expect("command builds");

        assert!(command.contains("--continue 'next; unsafe'"));
        assert!(command.contains("--chunk-size=100"));
    }

    #[test]
    fn remote_list_command_uses_discovered_context_source_when_profile_path_is_empty() {
        let command = remote_kubectl_command(
            None,
            Some("kubectl"),
            &KubernetesResourceQuery {
                profile_id: "profile".to_string(),
                context: KubernetesContextSelection {
                    source_id: "/home/operator/.kube/config".to_string(),
                    name: "prod".to_string(),
                    namespace: None,
                    user: None,
                },
                resource: "pods".to_string(),
                api_version: None,
                kind: None,
                namespaced: Some(true),
                namespace: None,
                label_selector: None,
                limit: 100,
                continue_token: None,
            },
            None,
        )
        .expect("command builds");
        assert!(command.contains("--kubeconfig '/home/operator/.kube/config'"));
    }

    #[test]
    fn rbac_probe_matches_group_qualified_remote_resources() {
        let resources = vec!["pods".to_string(), "deployments.apps".to_string()];
        assert!(remote_resource_is_discovered(
            WORKSPACE_PERMISSION_PROBES[0],
            &resources
        ));
        assert!(remote_resource_is_discovered(
            WORKSPACE_PERMISSION_PROBES[8],
            &resources
        ));
        let services_probe = WORKSPACE_PERMISSION_PROBES
            .iter()
            .copied()
            .find(|probe| probe.resource == "services")
            .expect("services probe");
        assert!(!remote_resource_is_discovered(services_probe, &resources));
    }

    #[test]
    fn log_truncation_keeps_utf8_boundary() {
        let (content, truncated) = truncate_log("x".repeat(2 * 1024 * 1024 + 1));
        assert!(truncated);
        assert_eq!(content.len(), 2 * 1024 * 1024);
    }

    #[test]
    fn exec_plugin_summary_redacts_arguments_and_requires_trust() {
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
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: /usr/local/bin/cloud-login
      args: ["credential", "--token=should-not-cross-tauri"]
contexts:
- name: prod
  context:
    cluster: production
    user: operator
"#,
        )
        .expect("fixture parses");
        let manager = KubernetesManager::default();
        let summaries = exec_plugin_summaries(&config, "/tmp/kubeconfig", &manager);
        assert_eq!(summaries.len(), 1);
        assert!(!summaries[0].trusted);
        let serialized = serde_json::to_string(&summaries).expect("serializes");
        assert!(!serialized.contains("should-not-cross-tauri"));
        assert!(
            ensure_exec_plugin_trusted(
                &config,
                "/tmp/kubeconfig",
                &KubernetesContextSelection {
                    source_id: "/tmp/kubeconfig".to_string(),
                    name: "prod".to_string(),
                    namespace: None,
                    user: None,
                },
                &manager,
            )
            .is_err()
        );
        manager
            .set_exec_plugin_trusted(&summaries[0].fingerprint, true)
            .expect("approval succeeds");
        assert!(
            ensure_exec_plugin_trusted(
                &config,
                "/tmp/kubeconfig",
                &KubernetesContextSelection {
                    source_id: "/tmp/kubeconfig".to_string(),
                    name: "prod".to_string(),
                    namespace: None,
                    user: None,
                },
                &manager,
            )
            .is_ok()
        );
    }

    #[test]
    fn imported_kubeconfig_rejects_external_secret_file_references() {
        let config = Kubeconfig::from_yaml(
            r#"
apiVersion: v1
clusters:
- name: production
  cluster:
    server: https://api.example.invalid
    certificate-authority: /private/ca.pem
users:
- name: operator
  user:
    tokenFile: /private/token
contexts:
- name: prod
  context:
    cluster: production
    user: operator
"#,
        )
        .expect("fixture parses");
        assert!(validate_importable_kubeconfig(&config).is_err());
    }
}
