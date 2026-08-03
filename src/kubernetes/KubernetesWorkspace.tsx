import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  KubernetesContextSelection,
  KubernetesCapabilities,
  KubernetesProfile,
  KubernetesPodLogs,
  KubernetesPermissionCheck,
  KubernetesResourceDocument,
  KubernetesResourceItem,
  KubernetesResourceKind,
  KubernetesResourceType,
  KubernetesDryRunResult,
  KubernetesApplyPreview,
  KubernetesMetricsResult,
  KubernetesPodExecRequest,
  KubernetesPortForwardInfo,
  KubernetesAuditEntry,
} from "../models";
import {
  getKubernetesResourceDocument,
  getKubernetesPodLogs,
  cancelKubernetesPodLogFollow,
  cancelKubernetesPortForward,
  cancelKubernetesResourceWatch,
  getKubernetesCapabilities,
  listKubernetesResources,
  onKubernetesPodLogEvent,
  onKubernetesPortForwardEvent,
  onKubernetesResourceWatchEvent,
  startKubernetesPodLogFollow,
  startKubernetesResourceWatch,
  previewKubernetesDryRun,
  serverDryRunKubernetesApply,
  applyKubernetesResources,
  deleteKubernetesResources,
  scaleKubernetesResource,
  restartKubernetesRollout,
  getKubernetesMetrics,
  listKubernetesAudit,
  listKubernetesPortForwards,
  startKubernetesPortForward,
  discoverRemoteKubernetes,
  scanImportedLocalKubeconfig,
  scanLocalKubeconfig,
} from "../services/kubernetesService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { writeTextFile } from "../services/configService";
import type { EditorOptions } from "../settings/settings";
import { KubernetesYamlEditor } from "./KubernetesYamlEditor";

const RESOURCE_OPTIONS: { label: string; value: KubernetesResourceKind }[] = [
  { label: "Pods", value: "pods" },
  { label: "Deployments", value: "deployments" },
  { label: "Services", value: "services" },
  { label: "Events", value: "events" },
  { label: "ConfigMaps", value: "configmaps" },
  { label: "Secrets（仅元数据）", value: "secrets" },
  { label: "Namespaces", value: "namespaces" },
  { label: "Nodes", value: "nodes" },
];

const RESOURCE_TEMPLATES = [
  { label: "空白资源", value: "blank", yaml: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n  namespace: default\ndata:\n  key: value\n" },
  { label: "Pod", value: "pod", yaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example\n  namespace: default\nspec:\n  containers:\n    - name: app\n      image: nginx:latest\n" },
  { label: "Deployment", value: "deployment", yaml: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: example\n  namespace: default\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: example\n  template:\n    metadata:\n      labels:\n        app: example\n    spec:\n      containers:\n        - name: app\n          image: nginx:latest\n          ports:\n            - containerPort: 80\n" },
  { label: "Service", value: "service", yaml: "apiVersion: v1\nkind: Service\nmetadata:\n  name: example\n  namespace: default\nspec:\n  selector:\n    app: example\n  ports:\n    - port: 80\n      targetPort: 80\n" },
  { label: "ConfigMap", value: "configmap", yaml: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example\n  namespace: default\ndata:\n  key: value\n" },
];

interface KubernetesWorkspaceProps {
  initialContext?: KubernetesContextSelection;
  profile: KubernetesProfile;
  editorOptions: EditorOptions;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenCli: (profile: KubernetesProfile, context: KubernetesContextSelection) => void;
  onOpenExec: (request: KubernetesPodExecRequest) => void;
}

function contextKey(context: KubernetesContextSelection) {
  return `${context.sourceId}\u0000${context.name}`;
}

interface KubernetesWorkspacePreferences {
  resource?: KubernetesResourceKind;
  namespace?: string;
  labelSelector?: string;
  autoRefresh?: boolean;
}

function workspacePreferencesKey(profileId: string, context: KubernetesContextSelection) {
  return `dssh.kubernetes.workspace.${profileId}.${encodeURIComponent(contextKey(context))}`;
}

function loadWorkspacePreferences(profileId: string, context: KubernetesContextSelection): KubernetesWorkspacePreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(workspacePreferencesKey(profileId, context)) ?? "{}");
    if (!value || typeof value !== "object") return {};
    const preferences = value as Record<string, unknown>;
    return {
      resource: typeof preferences.resource === "string" ? preferences.resource : undefined,
      namespace: typeof preferences.namespace === "string" ? preferences.namespace : undefined,
      labelSelector: typeof preferences.labelSelector === "string" ? preferences.labelSelector : undefined,
      autoRefresh: typeof preferences.autoRefresh === "boolean" ? preferences.autoRefresh : undefined,
    };
  } catch {
    return {};
  }
}

function permissionSummary(permissions: KubernetesPermissionCheck[]) {
  const denied = permissions.filter((item) => item.status === "denied").length;
  const unsupported = permissions.filter((item) => item.status === "unsupported").length;
  const failed = permissions.filter((item) => item.status === "error").length;
  const details = permissions.map((item) => {
    const scope = item.namespaced ? "命名空间" : "集群";
    const status = {
      allowed: "允许",
      denied: "拒绝",
      unsupported: "不支持",
      error: "检测失败",
    }[item.status];
    return `${scope} · ${item.verb} ${item.resource}：${status}${item.message ? `（${item.message}）` : ""}`;
  });
  const headline = failed > 0
    ? `权限检测有 ${failed} 项失败`
    : denied > 0 || unsupported > 0
      ? `权限受限：${denied} 项拒绝，${unsupported} 项不支持`
      : "权限检测完成";
  return { headline, text: [headline, ...details].join("\n") };
}

export function KubernetesWorkspace({ initialContext, onClose, onDirtyChange, onOpenCli, onOpenExec, profile, editorOptions }: KubernetesWorkspaceProps) {
  const initialWorkspaceContext = initialContext ?? profile.selectedContexts[0] ?? { sourceId: "", name: "" };
  const initialPreferences = loadWorkspacePreferences(profile.id, initialWorkspaceContext);
  const [context, setContext] = useState<KubernetesContextSelection>(initialWorkspaceContext);
  const [resource, setResource] = useState<KubernetesResourceKind>(initialPreferences.resource ?? "pods");
  const [dynamicResource, setDynamicResource] = useState<KubernetesResourceType | null>(null);
  const [namespace, setNamespace] = useState(initialPreferences.namespace ?? initialWorkspaceContext.namespace ?? "");
  const [labelSelector, setLabelSelector] = useState(initialPreferences.labelSelector ?? "");
  const [items, setItems] = useState<KubernetesResourceItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<KubernetesResourceItem | null>(null);
  const [document, setDocument] = useState<KubernetesResourceDocument | null>(null);
  const [editableYaml, setEditableYaml] = useState<string | null>(null);
  const [editorBaseYaml, setEditorBaseYaml] = useState<string | null>(null);
  const [dryRunPreview, setDryRunPreview] = useState<KubernetesDryRunResult | null>(null);
  const [serverApplyPreview, setServerApplyPreview] = useState<KubernetesApplyPreview | null>(null);
  const [serverApplyPreviewYaml, setServerApplyPreviewYaml] = useState<string | null>(null);
  const [forceApplyConflicts, setForceApplyConflicts] = useState(false);
  const [isCreatingResource, setIsCreatingResource] = useState(false);
  const [createTemplate, setCreateTemplate] = useState("blank");
  const [deletePropagation, setDeletePropagation] = useState<"foreground" | "background" | "orphan">("background");
  const [isApplying, setIsApplying] = useState(false);
  const [metrics, setMetrics] = useState<KubernetesMetricsResult | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [podLogs, setPodLogs] = useState<KubernetesPodLogs | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logContainer, setLogContainer] = useState("");
  const [logTailLines, setLogTailLines] = useState(2_000);
  const [logSinceSeconds, setLogSinceSeconds] = useState("");
  const [logTimestamps, setLogTimestamps] = useState(true);
  const [logPrevious, setLogPrevious] = useState(false);
  const [isFollowingLogs, setIsFollowingLogs] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [isExecPanelOpen, setIsExecPanelOpen] = useState(false);
  const [execContainer, setExecContainer] = useState("");
  const [execCommand, setExecCommand] = useState("/bin/sh");
  const [execTty, setExecTty] = useState(true);
  const [isPortForwardPanelOpen, setIsPortForwardPanelOpen] = useState(false);
  const [portForwardLocalPort, setPortForwardLocalPort] = useState(8080);
  const [portForwardRemotePort, setPortForwardRemotePort] = useState(80);
  const [portForwards, setPortForwards] = useState<KubernetesPortForwardInfo[]>([]);
  const [isAuditPanelOpen, setIsAuditPanelOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<KubernetesAuditEntry[]>([]);
  const logFollowOperationId = useRef<string | null>(null);
  const refreshGeneration = useRef(0);
  const resourceWatchOperationId = useRef<string | null>(null);
  const hasInitializedContext = useRef(false);
  const detailViewRef = useRef<HTMLElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceConfigNotice, setSourceConfigNotice] = useState<string | null>(null);
  const [sourceContextUnavailable, setSourceContextUnavailable] = useState(false);
  const [capabilities, setCapabilities] = useState<KubernetesCapabilities | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(() => initialPreferences.autoRefresh
    ?? localStorage.getItem(`dssh.kubernetes.autoRefresh.${profile.id}`) === "true");
  const [openContextKeys, setOpenContextKeys] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`dssh.kubernetes.tabs.${profile.id}`) ?? "[]") as unknown;
      const valid = Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
      const initial = contextKey(initialContext ?? profile.selectedContexts[0] ?? { sourceId: "", name: "" });
      return [...new Set([...valid, initial])].filter((key) => profile.selectedContexts.some((item) => contextKey(item) === key));
    } catch { return [contextKey(initialContext ?? profile.selectedContexts[0] ?? { sourceId: "", name: "" })]; }
  });
  const [watchRetryGeneration, setWatchRetryGeneration] = useState(0);

  const isNamespaced = dynamicResource?.namespaced ?? !["namespaces", "nodes"].includes(resource);
  const contextOptions = useMemo(
    () => profile.selectedContexts.map((item) => ({ label: item.name, value: contextKey(item) })),
    [profile.selectedContexts],
  );
  const resourceOptions = useMemo(() => [
    ...RESOURCE_OPTIONS,
    ...(capabilities?.resources
      .filter((item) => !RESOURCE_OPTIONS.some((known) => known.value === item.name))
      .map((item) => ({ label: `${item.kind} · ${item.apiVersion}`, value: `dynamic:${item.apiVersion}:${item.name}` })) ?? []),
  ], [capabilities]);
  const podContainers = useMemo(() => {
    const containers = (document?.json as { spec?: { containers?: unknown } } | null)?.spec?.containers;
    if (!Array.isArray(containers)) return [];
    return containers.flatMap((container) => {
      const name = typeof container === "object" && container !== null && "name" in container
        ? (container as { name?: unknown }).name
        : undefined;
      return typeof name === "string" && name ? [name] : [];
    });
  }, [document]);
  const filteredLogContent = useMemo(() => {
    if (!podLogs) return "";
    const query = logSearch.trim().toLocaleLowerCase();
    if (!query) return podLogs.content;
    return podLogs.content
      .split("\n")
      .filter((line) => line.toLocaleLowerCase().includes(query))
      .join("\n");
  }, [logSearch, podLogs]);
  const isYamlDirty = Boolean(editableYaml !== null && editorBaseYaml !== null && editableYaml !== editorBaseYaml);
  const canWrite = (verb: string) => capabilities?.permissions.some((item) => item.verb === verb && item.status === "allowed") ?? false;
  const hasPermission = (target: string, verb: string) => capabilities?.permissions.some(
    (item) => item.resource === target && item.verb === verb && item.status === "allowed",
  ) ?? false;

  useEffect(() => {
    onDirtyChange?.(isYamlDirty);
  }, [isYamlDirty, onDirtyChange]);

  function confirmDiscardYaml(): boolean {
    return !isYamlDirty || window.confirm("Kubernetes YAML 已修改但尚未保存。确定放弃修改吗？");
  }

  useEffect(() => {
    if (hasInitializedContext.current) {
      setNamespace(context.namespace ?? "");
    } else {
      hasInitializedContext.current = true;
    }
    setSelectedItem(null);
    setDocument(null);
    setEditableYaml(null);
    setEditorBaseYaml(null);
    setServerApplyPreview(null);
    setServerApplyPreviewYaml(null);
    setIsCreatingResource(false);
    setMetrics(null);
    setPodLogs(null);
    setLogSearch("");
    setLogContainer("");
    setIsExecPanelOpen(false);
    setExecContainer("");
    setIsPortForwardPanelOpen(false);
    void stopPodLogFollow();
  }, [context]);

  useEffect(() => {
    localStorage.setItem(`dssh.kubernetes.tabs.${profile.id}`, JSON.stringify(openContextKeys));
  }, [openContextKeys, profile.id]);

  useEffect(() => {
    if (!isNamespaced) setNamespace("");
  }, [isNamespaced]);

  async function refresh(append = false, preserveDetail = false) {
    if (!context.name || !context.sourceId) {
      setError("该 Kubernetes 配置尚未选择 context。请先编辑配置并发现 context。");
      return;
    }
    const generation = ++refreshGeneration.current;
    const currentSelectionKey = selectedItem ? `${selectedItem.namespace ?? "_"}\u0000${selectedItem.name}` : null;
    setIsLoading(true);
    setError(null);
    if (!preserveDetail) {
      setSelectedItem(null);
      setDocument(null);
      setPodLogs(null);
      setLogSearch("");
      setLogContainer("");
      void stopPodLogFollow();
    }
    try {
      const result = await listKubernetesResources({
        profileId: profile.id,
        context,
        resource,
        apiVersion: dynamicResource?.apiVersion || undefined,
        kind: dynamicResource?.kind || undefined,
        namespaced: dynamicResource?.namespaced,
        namespace: isNamespaced ? namespace.trim() || undefined : undefined,
        labelSelector: labelSelector.trim() || undefined,
        limit: 100,
        continueToken: append ? continueToken ?? undefined : undefined,
      });
      if (generation !== refreshGeneration.current) return;
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setContinueToken(result.continueToken ?? null);
      if (preserveDetail && currentSelectionKey) {
        const updatedSelection = result.items.find((item) => `${item.namespace ?? "_"}\u0000${item.name}` === currentSelectionKey);
        if (updatedSelection) setSelectedItem(updatedSelection);
      }
    } catch (cause) {
      if (generation !== refreshGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "读取 Kubernetes 资源失败。 ");
      if (!append) setItems([]);
    } finally {
      if (generation === refreshGeneration.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Resource selection is intentionally the automatic-refresh boundary;
    // filters are applied explicitly with the refresh button to avoid issuing
    // a request on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, resource]);

  useEffect(() => {
    if (!context.name || !context.sourceId) return;
    void getKubernetesCapabilities(profile.id, context).then(setCapabilities).catch(() => setCapabilities(null));
  }, [context, profile.id]);

  useEffect(() => {
    let disposed = false;
    async function checkSourceConfig() {
      try {
        const contexts = profile.source.kind === "local"
          ? (await scanLocalKubeconfig({ paths: profile.source.kubeconfigPaths })).contexts
          : profile.source.kind === "localImported"
            ? (await scanImportedLocalKubeconfig(profile.source)).contexts
            : (await discoverRemoteKubernetes(profile.source.sshProfileId, {
                kubeconfigPath: profile.source.kubeconfigPath,
                kubectlPath: profile.source.kubectlPath,
              })).candidates.flatMap((candidate) => candidate.contexts);
        if (disposed) return;
        const known = new Set(contexts.map((item) => contextKey(item)));
        const missing = profile.selectedContexts.filter((item) => !known.has(contextKey(item)));
        setSourceContextUnavailable(missing.some((item) => contextKey(item) === contextKey(context)));
        const selected = new Set(profile.selectedContexts.map((item) => contextKey(item)));
        const added = contexts.filter((item) => !selected.has(contextKey(item))).length;
        if (missing.length > 0) {
          setSourceConfigNotice(`配置来源已变化：${missing.map((item) => item.name).join("、")} 已不可用。当前工作区不会自动切换 context。`);
        } else if (added > 0) {
          setSourceConfigNotice(`配置来源已变化：发现 ${added} 个新 context。请编辑 Kubernetes 连接以选择并保存。`);
        } else {
          setSourceConfigNotice(null);
        }
      } catch {
        // A transient source / network error is surfaced by the normal resource
        // request path. Do not replace a prior useful configuration-change notice.
      }
    }
    void checkSourceConfig();
    const timer = window.setInterval(() => void checkSourceConfig(), 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [context, profile]);

  useEffect(() => {
    localStorage.setItem(workspacePreferencesKey(profile.id, context), JSON.stringify({
      resource,
      namespace,
      labelSelector,
      autoRefresh,
    } satisfies KubernetesWorkspacePreferences));
  }, [autoRefresh, context, labelSelector, namespace, profile.id, resource]);

  useEffect(() => {
    if (!autoRefresh || sourceContextUnavailable) return;
    const interval = window.setInterval(() => void refresh(false, true), 10_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, context, resource, namespace, labelSelector, profile.id, sourceContextUnavailable]);

  useEffect(() => {
    if (!autoRefresh || sourceContextUnavailable || !context.name || !context.sourceId) return;
    const operationId = crypto.randomUUID();
    resourceWatchOperationId.current = operationId;
    let disposed = false;
    let retryTimer: number | null = null;
    const unlisten = onKubernetesResourceWatchEvent((event) => {
      if (disposed || event.operationId !== resourceWatchOperationId.current) return;
      if (profile.source.kind === "remoteSsh" && (event.eventType === "reconnecting" || event.eventType === "reset")) {
        retryTimer = window.setTimeout(() => setWatchRetryGeneration((current) => current + 1), 1_000);
      }
      if (!event.item) return;
      setItems((current) => {
        const key = `${event.item?.namespace ?? "_"}\u0000${event.item?.name}`;
        const index = current.findIndex((item) => `${item.namespace ?? "_"}\u0000${item.name}` === key);
        if (event.eventType === "deleted") return index < 0 ? current : current.filter((_, itemIndex) => itemIndex !== index);
        if (event.eventType !== "added" && event.eventType !== "modified") return current;
        if (index < 0) return [event.item!, ...current];
        return current.map((item, itemIndex) => itemIndex === index ? event.item! : item);
      });
    });
    void startKubernetesResourceWatch({
      profileId: profile.id, context, resource,
      apiVersion: dynamicResource?.apiVersion || undefined, kind: dynamicResource?.kind || undefined,
      namespaced: dynamicResource?.namespaced, namespace: isNamespaced ? namespace.trim() || undefined : undefined,
      labelSelector: labelSelector.trim() || undefined, limit: 100,
    }, operationId).catch(() => undefined);
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (resourceWatchOperationId.current === operationId) resourceWatchOperationId.current = null;
      void cancelKubernetesResourceWatch(operationId);
      void unlisten.then((stop) => stop());
    };
  }, [autoRefresh, context, dynamicResource, isNamespaced, labelSelector, namespace, profile.id, profile.source.kind, resource, sourceContextUnavailable, watchRetryGeneration]);

  async function openDocument(item: KubernetesResourceItem) {
    if (!confirmDiscardYaml()) return;
    setSelectedItem(item);
    setPodLogs(null);
    setLogSearch("");
    setLogContainer("");
    setIsExecPanelOpen(false);
    setExecContainer("");
    setIsPortForwardPanelOpen(false);
    void stopPodLogFollow();
    setIsLoadingDocument(true);
    setError(null);
    try {
      const result = await getKubernetesResourceDocument({
        profileId: profile.id,
        context,
        resource,
        apiVersion: dynamicResource?.apiVersion || undefined,
        kind: dynamicResource?.kind || undefined,
        namespaced: dynamicResource?.namespaced,
        name: item.name,
        namespace: item.namespace ?? (isNamespaced ? namespace.trim() || undefined : undefined),
      });
      setDocument(result);
      setEditableYaml(null);
      setEditorBaseYaml(null);
      setServerApplyPreview(null);
      setServerApplyPreviewYaml(null);
      setIsCreatingResource(false);
      setDryRunPreview(null);
      setIsExecPanelOpen(false);
      setExecContainer("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 Kubernetes 资源详情失败。");
      setDocument(null);
    } finally {
      setIsLoadingDocument(false);
    }
  }

  async function openPodLogs() {
    if (!selectedItem || selectedItem.kind.toLowerCase() !== "pod") return;
    setIsLoadingLogs(true);
    setError(null);
    try {
      const result = await getKubernetesPodLogs({
        profileId: profile.id,
        context,
        pod: selectedItem.name,
        namespace: selectedItem.namespace ?? (namespace.trim() || undefined),
        container: logContainer || undefined,
        tailLines: logTailLines,
        sinceSeconds: logSinceSeconds.trim() ? Math.min(31_536_000, Math.max(1, Number(logSinceSeconds) || 1)) : undefined,
        timestamps: logTimestamps,
        previous: logPrevious,
      });
      setPodLogs(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 Pod 日志失败。");
      setPodLogs(null);
    } finally {
      setIsLoadingLogs(false);
    }
  }

  function openPodExec() {
    if (!selectedItem || selectedItem.kind.toLowerCase() !== "pod") return;
    const command = execCommand.trim().split(/\s+/).filter(Boolean).slice(0, 32);
    if (command.length === 0) {
      setError("请输入容器内要执行的 shell 或命令。");
      return;
    }
    onOpenExec({
      profileId: profile.id,
      context,
      pod: selectedItem.name,
      namespace: selectedItem.namespace ?? (namespace.trim() || undefined),
      container: execContainer || undefined,
      command,
      tty: execTty,
    });
  }

  async function startSelectedPortForward() {
    if (!selectedItem) return;
    const targetKind = selectedItem.kind.toLowerCase();
    if (targetKind !== "pod" && targetKind !== "service") {
      setError("端口转发只能选择 Pod 或 Service。 ");
      return;
    }
    if (!hasPermission("pods/portforward", "create")) {
      setError("当前身份没有 pods/portforward 权限。 ");
      return;
    }
    const localPort = Math.trunc(portForwardLocalPort);
    const remotePort = Math.trunc(portForwardRemotePort);
    if (localPort < 1 || localPort > 65_535 || remotePort < 1 || remotePort > 65_535) {
      setError("本地端口和目标端口必须在 1 到 65535 之间。 ");
      return;
    }
    setError(null);
    try {
      const info = await startKubernetesPortForward({
        profileId: profile.id,
        context,
        targetKind,
        targetName: selectedItem.name,
        namespace: selectedItem.namespace ?? (isNamespaced ? namespace.trim() || undefined : undefined),
        localPort,
        remotePort,
        operationId: crypto.randomUUID(),
      });
      setPortForwards((current) => [...current.filter((item) => item.operationId !== info.operationId), info]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "启动 Kubernetes 端口转发失败。 ");
    }
  }

  async function stopPortForward(operationId: string) {
    await cancelKubernetesPortForward(operationId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "取消 Kubernetes 端口转发失败。 ");
    });
  }

  async function previewDryRun() {
    if (editableYaml === null) return;
    setError(null);
    try { setDryRunPreview(await previewKubernetesDryRun(profile.id, context, editableYaml)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Kubernetes YAML 预检查失败。"); setDryRunPreview(null); }
  }

  async function previewServerApply() {
    if (editableYaml === null) return null;
    setError(null);
    try {
      const preview = await serverDryRunKubernetesApply({
        profileId: profile.id,
        context,
        yaml: editableYaml,
        fieldManager: "duo-ssh",
        force: forceApplyConflicts,
      });
      setServerApplyPreview(preview);
      setServerApplyPreviewYaml(editableYaml);
      return preview;
    } catch (cause) {
      setServerApplyPreview(null);
      setServerApplyPreviewYaml(null);
      setError(cause instanceof Error ? cause.message : "Kubernetes 服务端 dry-run 失败。");
      return null;
    }
  }

  async function saveEditedResource() {
    if (editableYaml === null || isApplying || !canWrite("patch") && !isCreatingResource && !canWrite("create")) return;
    setIsApplying(true);
    try {
      const preview = serverApplyPreviewYaml === editableYaml
        && serverApplyPreview?.message
        && serverApplyPreview.objects.length > 0
        ? serverApplyPreview
        : await previewServerApply();
      if (!preview) return;
      const summary = preview.manifests.map((item) => `${item.kind}/${item.name}`).join("、");
      if (!window.confirm(`确认应用 ${summary} 吗？服务端 dry-run 已通过，实际操作不可撤销。`)) return;
      if (forceApplyConflicts && !window.confirm("已启用强制解决 field manager 冲突，这可能覆盖其他控制器的字段。继续吗？")) return;
      const result = await applyKubernetesResources({ profileId: profile.id, context, yaml: editableYaml, fieldManager: "duo-ssh", force: forceApplyConflicts });
      const updated = result.objects[0];
      if (updated) {
        setDocument(updated);
        setSelectedItem(updated.item);
      }
      setEditableYaml(null);
      setEditorBaseYaml(null);
      setServerApplyPreview(null);
      setServerApplyPreviewYaml(null);
      setIsCreatingResource(false);
      await refresh(false, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "应用 Kubernetes 资源失败。");
    } finally {
      setIsApplying(false);
    }
  }

  function startCreateResource(templateValue = createTemplate) {
    if (!canWrite("create") && !canWrite("patch")) {
      setError("当前 context 没有创建或修改资源的权限。");
      return;
    }
    const template = RESOURCE_TEMPLATES.find((item) => item.value === templateValue) ?? RESOURCE_TEMPLATES[0];
    setSelectedItem(null);
    setDocument(null);
    setPodLogs(null);
    setIsCreatingResource(true);
    const templateYaml = template.yaml.replace(/namespace: default/g, namespace.trim() ? `namespace: ${namespace.trim()}` : "namespace: default");
    setEditableYaml(templateYaml);
    setEditorBaseYaml(templateYaml);
        setServerApplyPreview(null);
        setServerApplyPreviewYaml(null);
    setDryRunPreview(null);
  }

  async function deleteSelectedResource() {
    if (!selectedItem || !canWrite("delete")) return;
    if (!window.confirm(`确认删除 ${selectedItem.kind}/${selectedItem.name} 吗？传播策略：${deletePropagation}。`)) return;
    try {
      const result = await deleteKubernetesResources({
        profileId: profile.id,
        context,
        resource,
        apiVersion: dynamicResource?.apiVersion || undefined,
        kind: dynamicResource?.kind || selectedItem.kind,
        namespaced: dynamicResource?.namespaced ?? isNamespaced,
        names: [selectedItem.name],
        namespace: selectedItem.namespace ?? (isNamespaced ? namespace.trim() || undefined : undefined),
        propagation: deletePropagation,
        resourceVersion: selectedItem.resourceVersion,
      });
      if (result.items.some((item) => !item.success)) setError(result.items.filter((item) => !item.success).map((item) => item.message ?? item.name).join("；"));
      else {
        setSelectedItem(null);
        setDocument(null);
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除 Kubernetes 资源失败。");
    }
  }

  async function loadMetrics() {
    setIsLoadingMetrics(true);
    try {
      setMetrics(await getKubernetesMetrics({ profileId: profile.id, context, namespace: isNamespaced ? namespace.trim() || undefined : undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 Kubernetes 指标失败。");
      setMetrics(null);
    } finally {
      setIsLoadingMetrics(false);
    }
  }

  async function scaleSelected(replicas: number) {
    if (!selectedItem || !canWrite("patch")) return;
    try {
      const result = await scaleKubernetesResource({ profileId: profile.id, context, resource, apiVersion: dynamicResource?.apiVersion, kind: selectedItem.kind, namespaced: isNamespaced, name: selectedItem.name, namespace: selectedItem.namespace ?? (isNamespaced ? namespace.trim() || undefined : undefined), replicas, fieldManager: "duo-ssh" });
      if (result.object) setDocument(result.object);
      await refresh(false, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "扩缩容失败。"); }
  }

  async function restartSelectedRollout() {
    if (!selectedItem || !canWrite("patch") || !["deployment", "statefulset", "daemonset"].includes(selectedItem.kind.toLowerCase())) return;
    if (!window.confirm(`确认重启 ${selectedItem.kind}/${selectedItem.name} 吗？`)) return;
    try {
      const result = await restartKubernetesRollout({ profileId: profile.id, context, resource, apiVersion: dynamicResource?.apiVersion, kind: selectedItem.kind, namespaced: isNamespaced, name: selectedItem.name, namespace: selectedItem.namespace ?? (isNamespaced ? namespace.trim() || undefined : undefined), fieldManager: "duo-ssh" });
      if (result.object) setDocument(result.object);
      await refresh(false, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "滚动重启失败。"); }
  }

  async function startPodLogFollow() {
    if (!selectedItem || selectedItem.kind.toLowerCase() !== "pod" || logFollowOperationId.current) return;
    setError(null);
    setPodLogs({ content: "", truncated: false });
    const operationId = crypto.randomUUID();
    logFollowOperationId.current = operationId;
    setIsFollowingLogs(true);
    try {
      const acceptedOperationId = await startKubernetesPodLogFollow({
        profileId: profile.id,
        context,
        pod: selectedItem.name,
        namespace: selectedItem.namespace ?? (namespace.trim() || undefined),
        container: logContainer || undefined,
        tailLines: logTailLines,
        sinceSeconds: logSinceSeconds.trim() ? Math.min(31_536_000, Math.max(1, Number(logSinceSeconds) || 1)) : undefined,
        timestamps: logTimestamps,
        previous: logPrevious,
      }, operationId);
      if (acceptedOperationId !== operationId) {
        logFollowOperationId.current = acceptedOperationId;
      }
    } catch (cause) {
      logFollowOperationId.current = null;
      setIsFollowingLogs(false);
      setError(cause instanceof Error ? cause.message : "开始 Pod 日志跟随失败。");
    }
  }

  async function stopPodLogFollow() {
    const operationId = logFollowOperationId.current;
    logFollowOperationId.current = null;
    setIsFollowingLogs(false);
    if (operationId) await cancelKubernetesPodLogFollow(operationId).catch(() => undefined);
  }

  async function downloadPodLogs() {
    if (!podLogs || !selectedItem) return;
    try {
      const path = await save({
        defaultPath: `${selectedItem.name}.log`,
        filters: [{ name: "日志文件", extensions: ["log", "txt"] }],
        title: "保存 Pod 日志",
      });
      if (path) await writeTextFile(path, podLogs.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存 Pod 日志失败。");
    }
  }

  useEffect(() => {
    let disposed = false;
    const listener = onKubernetesPodLogEvent((event) => {
      if (disposed || event.operationId !== logFollowOperationId.current) return;
      if (event.eventType === "data" && event.data) {
        setPodLogs((current) => ({
          content: `${current?.content ?? ""}${event.data}`,
          truncated: current?.truncated ?? false,
        }));
      } else if (event.eventType === "truncated") {
        setPodLogs((current) => ({ content: current?.content ?? "", truncated: true }));
        logFollowOperationId.current = null;
        setIsFollowingLogs(false);
      } else if (event.eventType === "error") {
        setError(event.message ?? "读取 Pod 日志失败。");
        logFollowOperationId.current = null;
        setIsFollowingLogs(false);
      } else if (event.eventType === "completed" || event.eventType === "cancelled") {
        logFollowOperationId.current = null;
        setIsFollowingLogs(false);
      }
    });
    return () => {
      disposed = true;
      const operationId = logFollowOperationId.current;
      logFollowOperationId.current = null;
      if (operationId) void cancelKubernetesPodLogFollow(operationId);
      void listener.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshPortForwards = () => {
      void listKubernetesPortForwards()
        .then((items) => {
          if (!disposed) {
            setPortForwards(items.filter((item) => item.profileId === profile.id && item.context === context.name));
          }
        })
        .catch(() => undefined);
    };
    refreshPortForwards();
    const listener = onKubernetesPortForwardEvent((event) => {
      if (disposed) return;
      if (event.eventType === "started") {
        refreshPortForwards();
      } else {
        setPortForwards((current) => current.filter((item) => item.operationId !== event.operationId));
        if (event.eventType === "error" && event.message) setError(event.message);
      }
    });
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten());
    };
  }, [context.name, profile.id]);

  useEffect(() => {
    if (!isAuditPanelOpen) return;
    void listKubernetesAudit(profile.id, 200)
      .then((entries) => setAuditEntries(entries.filter((entry) => entry.context === context.name)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "读取 Kubernetes 审计记录失败。"));
  }, [context.name, isAuditPanelOpen, profile.id]);

  useEffect(() => {
    if (!isFollowingLogs || logSearch || !detailViewRef.current) return;
    detailViewRef.current.scrollTop = detailViewRef.current.scrollHeight;
  }, [isFollowingLogs, logSearch, podLogs?.content]);

  return (
    <section className="kubernetes-workspace" aria-label="Kubernetes 工作区">
      <header className="kubernetes-workspace__toolbar">
        <div className="kubernetes-workspace__title"><Icon name="database" height="17" width="17" /><strong>{profile.name}</strong></div>
        <div className="kubernetes-workspace__context-tabs">{openContextKeys.map((key) => {
          const tab = profile.selectedContexts.find((item) => contextKey(item) === key);
          if (!tab) return null;
          return <button className={contextKey(context) === key ? "is-active" : ""} key={key} onClick={() => setContext(tab)} type="button">{tab.name}<span aria-hidden="true" onClick={(event) => { event.stopPropagation(); setOpenContextKeys((current) => current.filter((item) => item !== key)); if (contextKey(context) === key) { const next = profile.selectedContexts.find((item) => contextKey(item) !== key); if (next) setContext(next); } }}>×</span></button>;
        })}</div>
        <SelectMenu
          ariaLabel="Kubernetes context"
          disabled={contextOptions.length === 0}
          onChange={(value) => {
            const next = profile.selectedContexts.find((item) => contextKey(item) === value);
            if (next) { setContext(next); setOpenContextKeys((current) => current.includes(value) ? current : [...current, value]); }
          }}
          options={contextOptions.length > 0 ? contextOptions : [{ disabled: true, label: "未选择 context", value: "" }]}
          value={contextKey(context)}
        />
        <SelectMenu ariaLabel="Kubernetes 资源类型" onChange={(value) => {
          if (value.startsWith("dynamic:")) {
            const [, apiVersion, name] = value.split(":");
            const found = capabilities?.resources.find((item) => item.apiVersion === apiVersion && item.name === name);
            if (found) { setDynamicResource(found); setResource(found.name); }
            return;
          }
          setDynamicResource(null); setResource(value);
        }} options={resourceOptions} value={dynamicResource ? `dynamic:${dynamicResource.apiVersion}:${dynamicResource.name}` : resource} />
        {isNamespaced ? <label className="kubernetes-workspace__filter"><span>命名空间</span><input onChange={(event) => setNamespace(event.currentTarget.value)} placeholder="全部命名空间" value={namespace} /></label> : null}
        <label className="kubernetes-workspace__filter"><span>标签</span><input onChange={(event) => setLabelSelector(event.currentTarget.value)} placeholder="app=api" value={labelSelector} /></label>
        <Button onClick={() => void refresh()} title="刷新资源" type="button" variant="ghost"><Icon name="refresh" height="15" width="15" />刷新</Button>
        <SelectMenu ariaLabel="创建资源模板" onChange={(value) => { setCreateTemplate(value); startCreateResource(value); }} options={RESOURCE_TEMPLATES.map((item) => ({ label: `创建 ${item.label}`, value: item.value }))} value={createTemplate} />
        <Button disabled={isLoadingMetrics} onClick={() => void loadMetrics()} title="读取 Metrics API" type="button" variant="ghost"><Icon name="gauge" height="15" width="15" />{isLoadingMetrics ? "指标中…" : "指标"}</Button>
        <Button onClick={() => setIsAuditPanelOpen((current) => !current)} title="查看 Kubernetes 操作审计" type="button" variant="ghost">审计</Button>
        {profile.source.kind !== "localImported" ? <Button onClick={() => onOpenCli(profile, context)} title="在来源一致的终端中打开 kubectl" type="button" variant="ghost"><Icon name="terminalTool" height="15" width="15" />CLI</Button> : <span className="kubernetes-workspace__identity" title="安全导入的 kubeconfig 不会写入终端环境；如需 CLI，请改用路径引用来源。">CLI 已禁用</span>}
        {editableYaml !== null ? <label className="kubernetes-workspace__force-apply"><input checked={forceApplyConflicts} onChange={(event) => setForceApplyConflicts(event.currentTarget.checked)} type="checkbox" />强制冲突</label> : null}
        <label className="kubernetes-workspace__auto-refresh"><input checked={autoRefresh} onChange={(event) => setAutoRefresh(event.currentTarget.checked)} type="checkbox" />自动刷新</label>
        {capabilities ? <span className="kubernetes-workspace__identity" title={`来源：${capabilities.source}\n${permissionSummary(capabilities.permissions).text}`}>{capabilities.username ?? "身份未知"}{capabilities.canListPods === false ? " · 只读受限" : ""}{capabilities.permissions.some((item) => item.status !== "allowed") ? ` · ${permissionSummary(capabilities.permissions).headline}` : ""}</span> : null}
        <button aria-label="关闭 Kubernetes 工作区" className="icon-button" onClick={() => { if (confirmDiscardYaml()) onClose(); }} title="关闭工作区" type="button"><Icon name="close" height="16" width="16" /></button>
      </header>
      {error ? <div className="kubernetes-workspace__error" role="alert">{error}</div> : null}
      {sourceConfigNotice ? <div className="kubernetes-workspace__source-notice" role="status">{sourceConfigNotice}</div> : null}
      <div className="kubernetes-workspace__content">
        <div className="kubernetes-workspace__list" aria-busy={isLoading}>
          <div className="kubernetes-workspace__table-head"><span>名称</span><span>命名空间</span><span>状态</span><span>创建时间</span></div>
          {isLoading ? <p className="kubernetes-workspace__empty">正在读取资源…</p> : items.length === 0 ? <p className="kubernetes-workspace__empty">没有匹配的资源。</p> : items.map((item) => (
            <button className={`kubernetes-workspace__row${selectedItem?.name === item.name && selectedItem.namespace === item.namespace ? " is-selected" : ""}`} key={`${item.namespace ?? "_"}/${item.name}`} onClick={() => void openDocument(item)} type="button">
              <span title={item.name}>{item.name}</span><span>{item.namespace ?? "—"}</span><span>{item.status ?? "—"}</span><span>{item.createdAt ?? "—"}</span>
            </button>
          ))}
          {!isLoading && continueToken ? <div className="kubernetes-workspace__load-more"><Button onClick={() => void refresh(true)} type="button" variant="ghost">加载更多</Button></div> : null}
        </div>
        <aside className="kubernetes-workspace__detail" aria-label="资源详情" ref={detailViewRef}>
          {isAuditPanelOpen ? <section className="kubernetes-workspace__audit"><div className="kubernetes-workspace__detail-head"><strong>操作审计 · {context.name}</strong><Button onClick={() => setIsAuditPanelOpen(false)} type="button" variant="ghost">关闭</Button></div>{auditEntries.length === 0 ? <p>当前 context 暂无本地审计记录。</p> : auditEntries.map((entry) => <div className="kubernetes-workspace__audit-row" key={entry.id}><div><strong>{entry.action}</strong><span>{entry.result}</span></div><div>{entry.resource ?? "资源"}{entry.names.length > 0 ? ` · ${entry.names.join("、")}` : ""}{entry.namespace ? ` · ${entry.namespace}` : ""}</div><small>{new Date(entry.createdAt).toLocaleString()} · {entry.source}{entry.errorCode ? ` · ${entry.errorCode}` : ""}</small></div>)}</section> : null}
          {metrics ? <section className="kubernetes-workspace__metrics"><div className="kubernetes-workspace__detail-head"><strong>资源指标</strong><Button onClick={() => setMetrics(null)} type="button" variant="ghost">关闭</Button></div>{metrics.message ? <p>{metrics.message}</p> : null}{metrics.items.map((item) => <div className="kubernetes-workspace__metric" key={`${item.namespace ?? "_"}/${item.name}`}><span>{item.name}</span><span>{item.cpu ?? "—"}</span><span>{item.memory ?? "—"}</span></div>)}</section> : null}
          {isLoadingDocument ? <p className="kubernetes-workspace__empty">正在读取资源详情…</p> : isCreatingResource && editableYaml !== null ? <>
            <div className="kubernetes-workspace__detail-head"><strong>新建资源{isYamlDirty ? " · 未保存" : ""}</strong><div><SelectMenu ariaLabel="资源模板" onChange={(value) => { setCreateTemplate(value); const template = RESOURCE_TEMPLATES.find((item) => item.value === value) ?? RESOURCE_TEMPLATES[0]; setEditableYaml(template.yaml); setEditorBaseYaml(template.yaml); setServerApplyPreview(null); setServerApplyPreviewYaml(null); }} options={RESOURCE_TEMPLATES.map((item) => ({ label: item.label, value: item.value }))} value={createTemplate} /><Button disabled={isApplying} onClick={() => void previewDryRun()} type="button" variant="ghost">预检查</Button><Button disabled={isApplying} onClick={() => void previewServerApply()} type="button" variant="ghost">服务端 dry-run</Button><Button disabled={isApplying} onClick={() => void saveEditedResource()} type="button" variant="primary">{isApplying ? "应用中…" : "应用"}</Button><Button onClick={() => { if (confirmDiscardYaml()) { setEditableYaml(null); setEditorBaseYaml(null); setServerApplyPreview(null); setServerApplyPreviewYaml(null); setIsCreatingResource(false); } }} type="button" variant="ghost">取消</Button></div></div>
            <KubernetesYamlEditor content={editableYaml} editorOptions={editorOptions} onChange={(value) => { setEditableYaml(value); setDryRunPreview(null); setServerApplyPreview(null); setServerApplyPreviewYaml(null); }} resourceId={`${profile.id}/${context.name}/new/${createTemplate}`} />
          </> : document ? <>
            <div className="kubernetes-workspace__detail-head"><strong>{document.item.kind} · {document.item.name}{isYamlDirty ? " · 未保存" : ""}</strong><div><Button disabled={document.redacted || (!canWrite("patch") && !canWrite("create"))} onClick={() => { if (editableYaml === null || confirmDiscardYaml()) { const next = editableYaml === null ? document.yaml : null; setEditableYaml(next); setEditorBaseYaml(next === null ? null : document.yaml); setServerApplyPreview(null); setServerApplyPreviewYaml(null); } }} type="button" variant="ghost">{editableYaml === null ? "编辑 YAML" : "只读 YAML"}</Button>{editableYaml !== null ? <><Button onClick={() => void previewDryRun()} type="button" variant="ghost">预检查</Button><Button onClick={() => void previewServerApply()} type="button" variant="ghost">服务端 dry-run</Button><Button disabled={isApplying} onClick={() => void saveEditedResource()} type="button" variant="primary">{isApplying ? "应用中…" : "应用"}</Button><Button onClick={() => { if (confirmDiscardYaml()) { setEditableYaml(null); setEditorBaseYaml(null); setServerApplyPreview(null); setServerApplyPreviewYaml(null); } }} type="button" variant="ghost">取消编辑</Button></> : null}{canWrite("delete") ? <><SelectMenu ariaLabel="删除传播策略" onChange={(value) => setDeletePropagation(value as typeof deletePropagation)} options={[{ label: "后台删除", value: "background" }, { label: "前台删除", value: "foreground" }, { label: "保留子资源", value: "orphan" }]} value={deletePropagation} /><Button onClick={() => void deleteSelectedResource()} type="button" variant="ghost">删除</Button></> : null}{["deployment", "statefulset", "daemonset"].includes(document.item.kind.toLowerCase()) && canWrite("patch") ? <><Button onClick={() => void scaleSelected(1)} type="button" variant="ghost">扩容至 1</Button><Button onClick={() => void restartSelectedRollout()} type="button" variant="ghost">滚动重启</Button></> : null}{document.item.kind.toLowerCase() === "pod" && hasPermission("pods/log", "get") ? <Button onClick={() => { setIsExecPanelOpen(false); setPodLogs(null); void openPodLogs(); }} type="button" variant="ghost">日志</Button> : null}{document.item.kind.toLowerCase() === "pod" && hasPermission("pods/exec", "create") ? <Button onClick={() => { setPodLogs(null); setIsExecPanelOpen((current) => !current); }} type="button" variant="ghost">Exec</Button> : null}{["pod", "service"].includes(document.item.kind.toLowerCase()) && hasPermission("pods/portforward", "create") ? <Button onClick={() => { setPodLogs(null); setIsPortForwardPanelOpen((current) => !current); }} type="button" variant="ghost">端口</Button> : null}{document.redacted ? <span>敏感数据已隐藏</span> : null}</div></div>
            {isExecPanelOpen && document.item.kind.toLowerCase() === "pod" ? <section className="kubernetes-workspace__exec-panel" aria-label="Pod Exec"><div className="kubernetes-workspace__exec-field"><span>容器</span>{podContainers.length > 0 ? <SelectMenu ariaLabel="Exec 容器" onChange={setExecContainer} options={[{ label: "默认容器", value: "" }, ...podContainers.map((name) => ({ label: name, value: name }))]} value={execContainer} /> : <span className="kubernetes-workspace__exec-muted">使用 Pod 默认容器</span>}</div><label className="kubernetes-workspace__exec-field"><span>命令</span><input aria-label="容器内命令" onChange={(event) => setExecCommand(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") openPodExec(); }} placeholder="/bin/sh" value={execCommand} /></label><label className="kubernetes-workspace__exec-check"><input checked={execTty} onChange={(event) => setExecTty(event.currentTarget.checked)} type="checkbox" />TTY（交互终端）</label><div className="kubernetes-workspace__exec-actions"><Button onClick={openPodExec} type="button" variant="primary">打开 Exec</Button><Button onClick={() => setIsExecPanelOpen(false)} type="button" variant="ghost">取消</Button></div></section> : null}
            {document.item.owners.length > 0 || document.item.selector.length > 0 ? <section className="kubernetes-workspace__relations" aria-label="资源关系"><strong>资源关系</strong>{document.item.owners.length > 0 ? <div><span className="kubernetes-workspace__relation-label">所有者</span>{document.item.owners.map((owner) => <span className="kubernetes-workspace__relation-chip" key={`${owner.apiVersion}/${owner.kind}/${owner.name}`}>{owner.kind}/{owner.name}</span>)}</div> : null}{document.item.selector.length > 0 ? <div><span className="kubernetes-workspace__relation-label">选择器</span>{document.item.selector.map((label) => <span className="kubernetes-workspace__relation-chip" key={`${label.key}=${label.value}`}>{label.key}={label.value}</span>)}</div> : null}<small>选择器关系仅依据资源公开的 matchLabels 展示，不代表已确认的所有者关系。</small></section> : null}
            {isPortForwardPanelOpen && ["pod", "service"].includes(document.item.kind.toLowerCase()) ? <section className="kubernetes-workspace__port-forward" aria-label="Kubernetes 端口转发"><div className="kubernetes-workspace__port-forward-form"><strong>端口转发 · {document.item.kind}</strong><label>本地端口<input max="65535" min="1" onChange={(event) => setPortForwardLocalPort(Number(event.currentTarget.value) || 0)} type="number" value={portForwardLocalPort} /></label><span>:</span><label>目标端口<input max="65535" min="1" onChange={(event) => setPortForwardRemotePort(Number(event.currentTarget.value) || 0)} type="number" value={portForwardRemotePort} /></label><Button onClick={() => void startSelectedPortForward()} type="button" variant="primary">启动</Button><Button onClick={() => setIsPortForwardPanelOpen(false)} type="button" variant="ghost">关闭</Button></div>{portForwards.length > 0 ? <div className="kubernetes-workspace__port-forward-list">{portForwards.map((item) => <div className="kubernetes-workspace__port-forward-item" key={item.operationId}><span>{item.targetKind}/{item.targetName} · 127.0.0.1:{item.localPort} → {item.remotePort}</span><Button onClick={() => void stopPortForward(item.operationId)} type="button" variant="ghost">取消</Button></div>)}</div> : <small className="kubernetes-workspace__port-forward-empty">当前 context 没有运行中的端口转发。</small>}</section> : null}
            {serverApplyPreview ? <section className="kubernetes-workspace__apply-preview"><p>{serverApplyPreview.message}</p><pre>{serverApplyPreview.diff || "服务端未返回结构差异。"}</pre></section> : null}
            {editableYaml !== null ? <><KubernetesYamlEditor content={editableYaml} editorOptions={editorOptions} onChange={(value) => { setEditableYaml(value); setDryRunPreview(null); setServerApplyPreview(null); setServerApplyPreviewYaml(null); }} resourceId={`${profile.id}/${context.name}/${document.item.apiVersion}/${document.item.kind}/${document.item.namespace ?? "_"}/${document.item.name}`} />{dryRunPreview ? <p className="kubernetes-workspace__dry-run">{dryRunPreview.message} {dryRunPreview.manifests.map((item) => `${item.kind}/${item.name}${item.namespace ? ` (${item.namespace})` : ""}`).join("，")}</p> : null}</> : isLoadingLogs ? <p className="kubernetes-workspace__empty">正在读取 Pod 日志…</p> : podLogs ? <><div className="kubernetes-workspace__log-controls">{podContainers.length > 1 ? <SelectMenu ariaLabel="Pod 容器" onChange={setLogContainer} options={[{ label: "默认容器", value: "" }, ...podContainers.map((name) => ({ label: name, value: name }))]} value={logContainer} /> : null}<label>最近 <input min="1" max="100000" onChange={(event) => setLogTailLines(Math.max(1, Number(event.currentTarget.value) || 1))} type="number" value={logTailLines} /> 行</label><label>最近 <input min="1" max="31536000" onChange={(event) => setLogSinceSeconds(event.currentTarget.value)} placeholder="全部" type="number" value={logSinceSeconds} /> 秒</label><label><input checked={logTimestamps} onChange={(event) => setLogTimestamps(event.currentTarget.checked)} type="checkbox" />时间戳</label><label><input checked={logPrevious} onChange={(event) => setLogPrevious(event.currentTarget.checked)} type="checkbox" />上次实例</label><input aria-label="搜索日志" className="kubernetes-workspace__log-search" onChange={(event) => setLogSearch(event.currentTarget.value)} placeholder="搜索日志" value={logSearch} /><Button onClick={() => void openPodLogs()} type="button" variant="ghost">刷新</Button><Button onClick={() => void (isFollowingLogs ? stopPodLogFollow() : startPodLogFollow())} type="button" variant="ghost">{isFollowingLogs ? "停止跟随" : "跟随日志"}</Button><Button onClick={() => void downloadPodLogs()} type="button" variant="ghost">下载</Button><Button onClick={() => { void stopPodLogFollow(); setPodLogs(null); }} type="button" variant="ghost">YAML</Button></div><pre className="kubernetes-workspace__logs">{filteredLogContent}</pre>{podLogs.truncated ? <p className="kubernetes-workspace__log-note">日志已按 2 MB 安全上限截断。</p> : null}</> : <pre>{document.yaml}</pre>}
          </> : <div className="kubernetes-workspace__empty"><p>从左侧选择资源查看详情，或创建一个新资源。</p><Button disabled={!canWrite("create") && !canWrite("patch")} onClick={() => startCreateResource()} type="button" variant="primary">创建资源</Button></div>}
        </aside>
      </div>
    </section>
  );
}
