import type {
  KubernetesProfile,
  KubernetesResourceDocument,
  KubernetesResourceKind,
  KubernetesResourceList,
  KubernetesCapabilities,
  KubernetesPodLogs,
  KubernetesCliLaunch,
  KubernetesPodLogEvent,
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

export function getKubernetesCapabilities(profileId: string, context: KubernetesProfile["selectedContexts"][number]) {
  return invokeCommand<KubernetesCapabilities>("get_kubernetes_capabilities", { request: { profileId, context } });
}
