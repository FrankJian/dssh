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

export type KubernetesResourceKind = string;

export interface KubernetesLabel {
  key: string;
  value: string;
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

export interface KubernetesCapabilities {
  resources: KubernetesResourceType[];
  canListPods?: boolean;
  canGetPods?: boolean;
  canCreatePods?: boolean;
  source: string;
  username?: string;
}
