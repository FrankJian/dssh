export interface KubernetesContextSummary {
  sourceId: string;
  name: string;
  cluster: string;
  user?: string;
  namespace?: string;
  isCurrent: boolean;
}

export interface LocalKubeconfigScanResult {
  sourcePaths: string[];
  contexts: KubernetesContextSummary[];
  currentContext?: string;
  execPlugins: KubernetesExecPluginSummary[];
}

export interface KubernetesExecPluginSummary {
  fingerprint: string;
  sourceId: string;
  contextName: string;
  user: string;
  command: string;
  argumentsSummary: string;
  environmentVariableNames: string[];
  trusted: boolean;
}

export interface KubernetesConnectionTestResult {
  context: KubernetesContextSelection;
  success: boolean;
  source: string;
  version?: string;
  username?: string;
  canListPods?: boolean;
  canGetPods?: boolean;
  message?: string;
}

export interface RemoteKubeconfigCandidate {
  path: string;
  contexts: KubernetesContextSummary[];
  currentContext?: string;
  error?: string;
}

export interface RemoteKubernetesDiscoveryResult {
  kubectlPath?: string;
  kubectlVersion?: string;
  candidates: RemoteKubeconfigCandidate[];
  warnings: string[];
}

export type KubernetesSource =
  | { kind: "local"; kubeconfigPaths: string[] }
  | { kind: "localImported"; secretRef: string; displayNames: string[] }
  | {
      kind: "remoteSsh";
      sshProfileId: string;
      kubeconfigPath?: string;
      kubectlPath?: string;
    };

export interface KubernetesContextSelection {
  sourceId: string;
  name: string;
  namespace?: string;
  user?: string;
}

export interface KubernetesProfile {
  id: string;
  name: string;
  source: KubernetesSource;
  selectedContexts: KubernetesContextSelection[];
  favorite: boolean;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportLocalKubeconfigResult {
  source: Extract<KubernetesSource, { kind: "localImported" }>;
  scan: LocalKubeconfigScanResult;
}

export type KubernetesResourceKind = string;

export interface KubernetesLabel {
  key: string;
  value: string;
}

export interface KubernetesOwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid?: string;
}

export interface KubernetesResourceItem {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  resourceVersion?: string;
  createdAt?: string;
  status?: string;
  labels: KubernetesLabel[];
  owners: KubernetesOwnerReference[];
  selector: KubernetesLabel[];
}

export interface KubernetesResourceList {
  items: KubernetesResourceItem[];
  namespace?: string;
  resource: KubernetesResourceKind;
  continueToken?: string;
}

export interface KubernetesResourceDocument {
  item: KubernetesResourceItem;
  json: unknown;
  yaml: string;
  redacted: boolean;
}

export interface KubernetesPodLogs {
  content: string;
  truncated: boolean;
}

export interface KubernetesPodLogEvent {
  operationId: string;
  eventType: "data" | "completed" | "cancelled" | "truncated" | "error";
  data?: string;
  message?: string;
}

export interface KubernetesCliLaunch {
  command: string;
  sshProfileId?: string;
  sourceLabel: string;
  kubectlVersion?: string;
  warning?: string;
}

export interface KubernetesResourceType {
  name: string;
  apiVersion: string;
  kind: string;
  namespaced: boolean;
  verbs: string[];
}

export interface KubernetesPermissionCheck {
  resource: string;
  apiGroup: string;
  verb: string;
  namespaced: boolean;
  /** `allowed`, `denied`, `unsupported`, or `error`. */
  status: "allowed" | "denied" | "unsupported" | "error";
  message?: string;
}

export interface KubernetesResourceWatchEvent {
  operationId: string;
  eventType: "added" | "modified" | "deleted" | "bookmark" | "reset" | "reconnecting" | "cancelled" | "error";
  item?: KubernetesResourceItem;
  resourceVersion?: string;
  message?: string;
}

export interface KubernetesManifestSummary { apiVersion: string; kind: string; name: string; namespace?: string; }
export interface KubernetesDryRunResult { manifests: KubernetesManifestSummary[]; message: string; }

export interface KubernetesApplyRequest {
  profileId: string;
  context: KubernetesContextSelection;
  yaml: string;
  fieldManager?: string;
  force?: boolean;
}

export interface KubernetesApplyPreview {
  manifests: KubernetesManifestSummary[];
  objects: KubernetesResourceDocument[];
  diff: string;
  serverDryRun: boolean;
  message: string;
}

export interface KubernetesApplyResult {
  manifests: KubernetesManifestSummary[];
  objects: KubernetesResourceDocument[];
  message: string;
}

export interface KubernetesDeleteRequest {
  profileId: string;
  context: KubernetesContextSelection;
  resource: string;
  apiVersion?: string;
  kind?: string;
  namespaced?: boolean;
  names: string[];
  namespace?: string;
  propagation?: "foreground" | "background" | "orphan";
  resourceVersion?: string;
}

export interface KubernetesDeleteResult {
  items: Array<{ name: string; success: boolean; message?: string }>;
  message: string;
}

export interface KubernetesScaleRequest {
  profileId: string;
  context: KubernetesContextSelection;
  resource: string;
  apiVersion?: string;
  kind?: string;
  namespaced?: boolean;
  name: string;
  namespace?: string;
  replicas: number;
  fieldManager?: string;
}

export interface KubernetesRolloutRequest {
  profileId: string;
  context: KubernetesContextSelection;
  resource: string;
  apiVersion?: string;
  kind?: string;
  namespaced?: boolean;
  name: string;
  namespace?: string;
  fieldManager?: string;
}

export interface KubernetesActionResult {
  name: string;
  action: string;
  object?: KubernetesResourceDocument;
  message: string;
}

export interface KubernetesPodExecRequest {
  profileId: string;
  context: KubernetesContextSelection;
  pod: string;
  namespace?: string;
  container?: string;
  command?: string[];
  tty?: boolean;
}

export interface KubernetesExecLaunch {
  command: string;
  sshProfileId?: string;
  sourceLabel: string;
}

export interface KubernetesPortForwardRequest {
  profileId: string;
  context: KubernetesContextSelection;
  targetKind: "pod" | "service";
  targetName: string;
  namespace?: string;
  localPort: number;
  remotePort: number;
  operationId?: string;
}

export interface KubernetesPortForwardInfo {
  operationId: string;
  profileId: string;
  context: string;
  targetKind: string;
  targetName: string;
  namespace?: string;
  localPort: number;
  remotePort: number;
  source: string;
  status: string;
}

export interface KubernetesPortForwardEvent {
  operationId: string;
  eventType: "started" | "completed" | "cancelled" | "error";
  message?: string;
}

export interface KubernetesMetricsResult {
  source: string;
  available: boolean;
  items: Array<{ name: string; namespace?: string; cpu?: string; memory?: string }>;
  message?: string;
}

export interface KubernetesAuditEntry {
  id: number;
  profileId: string;
  source: string;
  context: string;
  identity?: string;
  resource?: string;
  namespace?: string;
  names: string[];
  action: string;
  result: string;
  errorCode?: string;
  createdAt: string;
}

export interface KubernetesMetricsRequest {
  profileId: string;
  context: KubernetesContextSelection;
  namespace?: string;
  pod?: string;
}

export interface KubernetesCapabilities {
  resources: KubernetesResourceType[];
  canListPods?: boolean;
  canGetPods?: boolean;
  canCreatePods?: boolean;
  permissions: KubernetesPermissionCheck[];
  source: string;
  username?: string;
}
