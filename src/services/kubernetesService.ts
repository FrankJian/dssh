import type {
  KubernetesProfile,
  KubernetesResourceDocument,
  KubernetesResourceKind,
  KubernetesResourceList,
  KubernetesCapabilities,
  KubernetesPodLogs,
  KubernetesCliLaunch,
  KubernetesConnectionTestResult,
  KubernetesPodLogEvent,
  KubernetesResourceWatchEvent,
  KubernetesDryRunResult,
  KubernetesApplyPreview,
  KubernetesApplyResult,
  KubernetesDeleteResult,
  KubernetesActionResult,
  KubernetesExecLaunch,
  KubernetesMetricsResult,
  KubernetesAuditEntry,
  KubernetesPortForwardEvent,
  KubernetesPortForwardInfo,
  ImportLocalKubeconfigResult,
  LocalKubeconfigScanResult,
  RemoteKubernetesDiscoveryResult,
} from "../models";
import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "./tauri";

export interface LocalKubeconfigScanRequest {
  paths: string[];
}

export interface RemoteKubernetesDiscoveryRequest {
  kubectlPath?: string;
  kubeconfigPath?: string;
}

export interface CreateKubernetesProfileRequest {
  name: string;
  source: KubernetesProfile["source"];
  selectedContexts: KubernetesProfile["selectedContexts"];
  favorite: boolean;
  description?: string;
  tags: string[];
}

export interface UpdateKubernetesProfileRequest extends CreateKubernetesProfileRequest {
  id: string;
}

export function scanLocalKubeconfig(request: LocalKubeconfigScanRequest) {
  return invokeCommand<LocalKubeconfigScanResult>("scan_local_kubeconfig", { request });
}

export function importLocalKubeconfig(paths: string[]) {
  return invokeCommand<ImportLocalKubeconfigResult>("import_local_kubeconfig", { request: { paths } });
}

export function scanImportedLocalKubeconfig(source: Extract<KubernetesProfile["source"], { kind: "localImported" }>) {
  return invokeCommand<LocalKubeconfigScanResult>("scan_imported_local_kubeconfig", { source });
}

export function discardImportedLocalKubeconfig(secretRef: string) {
  return invokeCommand<void>("discard_imported_local_kubeconfig", { secretRef });
}

export function setKubernetesExecPluginTrust(fingerprint: string, trusted: boolean) {
  return invokeCommand<void>("set_kubernetes_exec_plugin_trust", {
    request: { fingerprint, trusted },
  });
}

export function testKubernetesConnection(
  source: KubernetesProfile["source"],
  contexts: KubernetesProfile["selectedContexts"],
) {
  return invokeCommand<KubernetesConnectionTestResult[]>("test_kubernetes_connection", {
    request: { source, contexts },
  });
}

export function discoverRemoteKubernetes(
  profileId: string,
  request: RemoteKubernetesDiscoveryRequest,
) {
  return invokeCommand<RemoteKubernetesDiscoveryResult>("discover_remote_kubernetes", {
    profileId,
    request,
  });
}

export function listKubernetesProfiles() {
  return invokeCommand<KubernetesProfile[]>("list_kubernetes_profiles");
}

export function listKubernetesAudit(profileId?: string, limit = 200) {
  return invokeCommand<KubernetesAuditEntry[]>("list_kubernetes_audit", { profileId, limit });
}

export function createKubernetesProfile(request: CreateKubernetesProfileRequest) {
  return invokeCommand<KubernetesProfile>("create_kubernetes_profile", { request });
}

export function updateKubernetesProfile(request: UpdateKubernetesProfileRequest) {
  return invokeCommand<KubernetesProfile>("update_kubernetes_profile", { request });
}

export function deleteKubernetesProfile(id: string) {
  return invokeCommand<void>("delete_kubernetes_profile", { id });
}

export function setKubernetesProfileFavorite(id: string, favorite: boolean) {
  return invokeCommand<KubernetesProfile>("set_kubernetes_profile_favorite", { id, favorite });
}

export interface KubernetesResourceQuery {
  profileId: string;
  context: KubernetesProfile["selectedContexts"][number];
  resource: KubernetesResourceKind;
  apiVersion?: string;
  kind?: string;
  namespaced?: boolean;
  namespace?: string;
  labelSelector?: string;
  limit?: number;
  continueToken?: string;
}

export interface KubernetesResourceDocumentRequest {
  profileId: string;
  context: KubernetesProfile["selectedContexts"][number];
  resource: KubernetesResourceKind;
  apiVersion?: string;
  kind?: string;
  namespaced?: boolean;
  name: string;
  namespace?: string;
}

export interface KubernetesPodLogsRequest {
  profileId: string;
  context: KubernetesProfile["selectedContexts"][number];
  pod: string;
  namespace?: string;
  container?: string;
  tailLines?: number;
  sinceSeconds?: number;
  timestamps?: boolean;
  previous?: boolean;
  operationId?: string;
}

export function listKubernetesResources(query: KubernetesResourceQuery) {
  return invokeCommand<KubernetesResourceList>("list_kubernetes_resources", { query });
}

export function previewKubernetesDryRun(profileId: string, context: KubernetesProfile["selectedContexts"][number], yaml: string) {
  return invokeCommand<KubernetesDryRunResult>("preview_kubernetes_dry_run", { request: { profileId, context, yaml } });
}

export function serverDryRunKubernetesApply(request: import("../models").KubernetesApplyRequest) {
  return invokeCommand<KubernetesApplyPreview>("server_dry_run_kubernetes_apply", { request });
}

export function applyKubernetesResources(request: import("../models").KubernetesApplyRequest) {
  return invokeCommand<KubernetesApplyResult>("apply_kubernetes_resources", { request });
}

export function deleteKubernetesResources(request: import("../models").KubernetesDeleteRequest) {
  return invokeCommand<KubernetesDeleteResult>("delete_kubernetes_resources", { request });
}

export function scaleKubernetesResource(request: import("../models").KubernetesScaleRequest) {
  return invokeCommand<KubernetesActionResult>("scale_kubernetes_resource", { request });
}

export function restartKubernetesRollout(request: import("../models").KubernetesRolloutRequest) {
  return invokeCommand<KubernetesActionResult>("restart_kubernetes_rollout", { request });
}

export function getKubernetesMetrics(request: import("../models").KubernetesMetricsRequest) {
  return invokeCommand<KubernetesMetricsResult>("get_kubernetes_metrics", { request });
}

export function startKubernetesResourceWatch(query: KubernetesResourceQuery, operationId: string) {
  return invokeCommand<string>("start_kubernetes_resource_watch", { request: { ...query, operationId } });
}

export function cancelKubernetesResourceWatch(operationId: string) {
  return invokeCommand<void>("cancel_kubernetes_resource_watch", { operationId });
}

export function onKubernetesResourceWatchEvent(handler: (event: KubernetesResourceWatchEvent) => void) {
  return listen<KubernetesResourceWatchEvent>("kubernetes://resource-watch", (event) => handler(event.payload));
}

export function startKubernetesPortForward(request: import("../models").KubernetesPortForwardRequest) {
  return invokeCommand<KubernetesPortForwardInfo>("start_kubernetes_port_forward", { request });
}

export function cancelKubernetesPortForward(operationId: string) {
  return invokeCommand<void>("cancel_kubernetes_port_forward", { operationId });
}

export function listKubernetesPortForwards() {
  return invokeCommand<KubernetesPortForwardInfo[]>("list_kubernetes_port_forwards");
}

export function onKubernetesPortForwardEvent(handler: (event: KubernetesPortForwardEvent) => void) {
  return listen<KubernetesPortForwardEvent>("kubernetes://port-forward", (event) => handler(event.payload));
}

export function getKubernetesResourceDocument(request: KubernetesResourceDocumentRequest) {
  return invokeCommand<KubernetesResourceDocument>("get_kubernetes_resource_document", { request });
}

export function getKubernetesPodLogs(request: KubernetesPodLogsRequest) {
  return invokeCommand<KubernetesPodLogs>("get_kubernetes_pod_logs", { request });
}

export function startKubernetesPodLogFollow(request: KubernetesPodLogsRequest, operationId: string) {
  const followRequest = { ...request, operationId };
  return invokeCommand<string>("start_kubernetes_pod_log_follow", { request: followRequest });
}

export function cancelKubernetesPodLogFollow(operationId: string) {
  return invokeCommand<void>("cancel_kubernetes_pod_log_follow", { operationId });
}

export function onKubernetesPodLogEvent(handler: (event: KubernetesPodLogEvent) => void) {
  return listen<KubernetesPodLogEvent>("kubernetes://pod-log", (event) => handler(event.payload));
}

export function prepareKubernetesCli(profileId: string, context: KubernetesProfile["selectedContexts"][number]) {
  return invokeCommand<KubernetesCliLaunch>("prepare_kubernetes_cli", { request: { profileId, context } });
}

export function prepareKubernetesPodExec(request: import("../models").KubernetesPodExecRequest) {
  return invokeCommand<KubernetesExecLaunch>("prepare_kubernetes_pod_exec", { request });
}

export function getKubernetesCapabilities(profileId: string, context: KubernetesProfile["selectedContexts"][number]) {
  return invokeCommand<KubernetesCapabilities>("get_kubernetes_capabilities", { request: { profileId, context } });
}
