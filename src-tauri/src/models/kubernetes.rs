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
        #[serde(default)]
        kubeconfig_paths: Vec<String>,
    },
    RemoteSsh {
        ssh_profile_id: String,
        #[serde(default)]
        kubeconfig_path: Option<String>,
        #[serde(default)]
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesLabel {
    pub key: String,
    pub value: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesCapabilities {
    pub resources: Vec<KubernetesResourceType>,
    pub can_list_pods: Option<bool>,
    pub can_get_pods: Option<bool>,
    pub can_create_pods: Option<bool>,
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
