use serde::{Deserialize, Serialize};

/// A saved Kubernetes connection deliberately stores only references to
/// kubeconfig material.  Kubeconfigs often contain bearer tokens, client
/// certificates, and exec-plugin configuration, so copying their contents to
/// the application database is not permitted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KubernetesSource {
    Local {
        /// Empty paths means `KUBECONFIG` / the platform default at use time.
        #[serde(default, rename = "kubeconfigPaths")]
        kubeconfig_paths: Vec<String>,
    },
    /// An app-managed kubeconfig stored in the platform credential store.
    /// `secret_ref` is a random opaque identifier, never the kubeconfig body.
    LocalImported {
        #[serde(rename = "secretRef")]
        secret_ref: String,
        #[serde(default, rename = "displayNames")]
        display_names: Vec<String>,
    },
    RemoteSsh {
        #[serde(rename = "sshProfileId")]
        ssh_profile_id: String,
        #[serde(default, rename = "kubeconfigPath")]
        kubeconfig_path: Option<String>,
        #[serde(default, rename = "kubectlPath")]
        kubectl_path: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesContextSelection {
    pub source_id: String,
    pub name: String,
    #[serde(default)]
    pub namespace: Option<String>,
    /// Non-secret kubeconfig user name, when source discovery knows it.
    #[serde(default)]
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesProfile {
    pub id: String,
    pub name: String,
    pub source: KubernetesSource,
    #[serde(default)]
    pub selected_contexts: Vec<KubernetesContextSelection>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKubernetesProfileRequest {
    pub name: String,
    pub source: KubernetesSource,
    #[serde(default)]
    pub selected_contexts: Vec<KubernetesContextSelection>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKubernetesProfileRequest {
    pub id: String,
    pub name: String,
    pub source: KubernetesSource,
    #[serde(default)]
    pub selected_contexts: Vec<KubernetesContextSelection>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Non-secret summary of one context discovered from a kubeconfig.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesContextSummary {
    pub source_id: String,
    pub name: String,
    pub cluster: String,
    pub user: Option<String>,
    pub namespace: Option<String>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalKubeconfigScanRequest {
    /// Empty means `KUBECONFIG` or the platform default (`~/.kube/config`).
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalKubeconfigScanResult {
    pub source_paths: Vec<String>,
    pub contexts: Vec<KubernetesContextSummary>,
    pub current_context: Option<String>,
    #[serde(default)]
    pub exec_plugins: Vec<KubernetesExecPluginSummary>,
}

/// Request to copy a user-selected kubeconfig into the operating system's
/// secure credential store. The file itself is read only in Rust.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalKubeconfigRequest {
    pub paths: Vec<String>,
}

/// Non-secret result of a secure kubeconfig import.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalKubeconfigResult {
    pub source: KubernetesSource,
    pub scan: LocalKubeconfigScanResult,
}

/// Non-secret description of an exec credential plugin. Arguments are
/// redacted before they cross the Tauri boundary; only their safe summary and
/// configured environment variable names are visible to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesExecPluginSummary {
    pub fingerprint: String,
    pub source_id: String,
    pub context_name: String,
    pub user: String,
    pub command: String,
    pub arguments_summary: String,
    pub environment_variable_names: Vec<String>,
    pub trusted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesExecPluginTrustRequest {
    pub fingerprint: String,
    pub trusted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesConnectionTestRequest {
    pub source: KubernetesSource,
    #[serde(default)]
    pub contexts: Vec<KubernetesContextSelection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesConnectionTestResult {
    pub context: KubernetesContextSelection,
    pub success: bool,
    pub source: String,
    pub version: Option<String>,
    pub username: Option<String>,
    pub can_list_pods: Option<bool>,
    pub can_get_pods: Option<bool>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteKubernetesDiscoveryRequest {
    pub kubectl_path: Option<String>,
    pub kubeconfig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteKubeconfigCandidate {
    pub path: String,
    pub contexts: Vec<KubernetesContextSummary>,
    pub current_context: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteKubernetesDiscoveryResult {
    pub kubectl_path: Option<String>,
    pub kubectl_version: Option<String>,
    pub candidates: Vec<RemoteKubeconfigCandidate>,
    pub warnings: Vec<String>,
}

/// Read-only resource kinds provided by the initial Kubernetes workspace.
/// The string form is deliberately stable across local API and remote kubectl
/// backends, rather than exposing an arbitrary shell resource expression.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceQuery {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub resource: String,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub namespaced: Option<bool>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub label_selector: Option<String>,
    #[serde(default = "default_resource_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub continue_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceItem {
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub namespace: Option<String>,
    pub resource_version: Option<String>,
    pub created_at: Option<String>,
    pub status: Option<String>,
    pub labels: Vec<KubernetesLabel>,
    #[serde(default)]
    pub owners: Vec<KubernetesOwnerReference>,
    /// Labels from `spec.selector.matchLabels`, when the resource exposes a
    /// selector. These are deliberately kept separate from metadata labels so
    /// the UI does not present an inferred relationship as an owner link.
    #[serde(default)]
    pub selector: Vec<KubernetesLabel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesLabel {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesOwnerReference {
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub uid: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceList {
    pub items: Vec<KubernetesResourceItem>,
    pub namespace: Option<String>,
    pub resource: String,
    pub continue_token: Option<String>,
}

fn default_resource_page_size() -> u32 {
    100
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceDocumentRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub resource: String,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub namespaced: Option<bool>,
    pub name: String,
    #[serde(default)]
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceDocument {
    pub item: KubernetesResourceItem,
    pub json: serde_json::Value,
    pub yaml: String,
    pub redacted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesCapabilityRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceType {
    pub name: String,
    pub api_version: String,
    pub kind: String,
    pub namespaced: bool,
    pub verbs: Vec<String>,
}

/// One non-mutating authorization probe used to describe which workspace
/// actions are available. The status intentionally distinguishes a denied
/// action from an unavailable API or an inconclusive probe.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPermissionCheck {
    pub resource: String,
    pub api_group: String,
    pub verb: String,
    pub namespaced: bool,
    /// `allowed`, `denied`, `unsupported`, or `error`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesCapabilities {
    pub resources: Vec<KubernetesResourceType>,
    pub can_list_pods: Option<bool>,
    pub can_get_pods: Option<bool>,
    pub can_create_pods: Option<bool>,
    #[serde(default)]
    pub permissions: Vec<KubernetesPermissionCheck>,
    pub source: String,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPodLogsRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub pod: String,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub tail_lines: Option<i64>,
    #[serde(default)]
    pub since_seconds: Option<i64>,
    #[serde(default)]
    pub timestamps: bool,
    #[serde(default)]
    pub previous: bool,
    /// Caller-provided only for a follow operation, so the frontend can begin
    /// listening before the async task is scheduled.
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPodLogs {
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPodLogEvent {
    pub operation_id: String,
    /// `data`, `completed`, `cancelled`, `truncated`, or `error`.
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceWatchRequest {
    #[serde(flatten)]
    pub query: KubernetesResourceQuery,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesResourceWatchEvent {
    pub operation_id: String,
    /// `added`, `modified`, `deleted`, `bookmark`, `reset`, `reconnecting`,
    /// `cancelled`, or `error`.
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<KubernetesResourceItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesDryRunRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub yaml: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesManifestSummary {
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub namespace: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesDryRunResult {
    pub manifests: Vec<KubernetesManifestSummary>,
    pub message: String,
}

/// A write request always carries structured YAML and a context. The frontend
/// never sends a shell command; the source-aware backend decides whether to
/// call the local API or remote kubectl.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesApplyRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub yaml: String,
    #[serde(default = "default_field_manager")]
    pub field_manager: String,
    #[serde(default)]
    pub force: bool,
}

fn default_field_manager() -> String {
    "duo-ssh".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesApplyPreview {
    pub manifests: Vec<KubernetesManifestSummary>,
    pub objects: Vec<KubernetesResourceDocument>,
    pub diff: String,
    pub server_dry_run: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesApplyResult {
    pub manifests: Vec<KubernetesManifestSummary>,
    pub objects: Vec<KubernetesResourceDocument>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesDeleteRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub resource: String,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub namespaced: Option<bool>,
    pub names: Vec<String>,
    #[serde(default)]
    pub namespace: Option<String>,
    /// `foreground`, `background`, or `orphan`.
    #[serde(default = "default_delete_propagation")]
    pub propagation: String,
    #[serde(default)]
    pub resource_version: Option<String>,
}

fn default_delete_propagation() -> String {
    "background".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesDeleteItemResult {
    pub name: String,
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesDeleteResult {
    pub items: Vec<KubernetesDeleteItemResult>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesScaleRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub resource: String,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub namespaced: Option<bool>,
    pub name: String,
    #[serde(default)]
    pub namespace: Option<String>,
    pub replicas: u32,
    #[serde(default = "default_field_manager")]
    pub field_manager: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesRolloutRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub resource: String,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub namespaced: Option<bool>,
    pub name: String,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default = "default_field_manager")]
    pub field_manager: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesActionResult {
    pub name: String,
    pub action: String,
    pub object: Option<KubernetesResourceDocument>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPodExecRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    pub pod: String,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub container: Option<String>,
    #[serde(default)]
    pub command: Vec<String>,
    #[serde(default)]
    pub tty: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesExecLaunch {
    pub command: String,
    pub ssh_profile_id: Option<String>,
    pub source_label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPortForwardRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    /// Only `pod` and `service` are accepted. The value is converted to a
    /// structured kubectl resource argument by Rust.
    pub target_kind: String,
    pub target_name: String,
    #[serde(default)]
    pub namespace: Option<String>,
    pub local_port: u16,
    pub remote_port: u16,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPortForwardInfo {
    pub operation_id: String,
    pub profile_id: String,
    pub context: String,
    pub target_kind: String,
    pub target_name: String,
    pub namespace: Option<String>,
    pub local_port: u16,
    pub remote_port: u16,
    pub source: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesPortForwardEvent {
    pub operation_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesMetricsRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub pod: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesMetricItem {
    pub name: String,
    pub namespace: Option<String>,
    pub cpu: Option<String>,
    pub memory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesMetricsResult {
    pub source: String,
    pub available: bool,
    pub items: Vec<KubernetesMetricItem>,
    pub message: Option<String>,
}

/// Redacted record of a mutating Kubernetes action. YAML, kubeconfig,
/// tokens, and Secret values are intentionally not represented here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesAuditEntry {
    pub id: i64,
    pub profile_id: String,
    pub source: String,
    pub context: String,
    pub identity: Option<String>,
    pub resource: Option<String>,
    pub namespace: Option<String>,
    pub names: Vec<String>,
    pub action: String,
    pub result: String,
    pub error_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesCliRequest {
    pub profile_id: String,
    pub context: KubernetesContextSelection,
}

/// A non-secret, already shell-quoted command for a terminal session.  The
/// frontend selects the terminal transport from `ssh_profile_id` but never
/// constructs a command from user-supplied Kubernetes values.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesCliLaunch {
    pub command: String,
    pub ssh_profile_id: Option<String>,
    pub source_label: String,
    pub kubectl_version: Option<String>,
    pub warning: Option<String>,
}
