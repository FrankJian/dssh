import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  KubernetesContextSelection,
  KubernetesCapabilities,
  KubernetesProfile,
  KubernetesPodLogs,
  KubernetesResourceDocument,
  KubernetesResourceItem,
  KubernetesResourceKind,
  KubernetesResourceType,
} from "../models";
import {
  getKubernetesResourceDocument,
  getKubernetesPodLogs,
  cancelKubernetesPodLogFollow,
  getKubernetesCapabilities,
  listKubernetesResources,
  onKubernetesPodLogEvent,
  startKubernetesPodLogFollow,
} from "../services/kubernetesService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { writeTextFile } from "../services/configService";

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

interface KubernetesWorkspaceProps {
  initialContext?: KubernetesContextSelection;
  profile: KubernetesProfile;
  onClose: () => void;
  onOpenCli: (profile: KubernetesProfile, context: KubernetesContextSelection) => void;
}

function contextKey(context: KubernetesContextSelection) {
  return `${context.sourceId}\u0000${context.name}`;
}

export function KubernetesWorkspace({ initialContext, onClose, onOpenCli, profile }: KubernetesWorkspaceProps) {
  const [context, setContext] = useState<KubernetesContextSelection>(
    initialContext ?? profile.selectedContexts[0] ?? { sourceId: "", name: "" },
  );
  const [resource, setResource] = useState<KubernetesResourceKind>("pods");
  const [dynamicResource, setDynamicResource] = useState<KubernetesResourceType | null>(null);
  const [namespace, setNamespace] = useState(context.namespace ?? "");
  const [labelSelector, setLabelSelector] = useState("");
  const [items, setItems] = useState<KubernetesResourceItem[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<KubernetesResourceItem | null>(null);
  const [document, setDocument] = useState<KubernetesResourceDocument | null>(null);
  const [podLogs, setPodLogs] = useState<KubernetesPodLogs | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logContainer, setLogContainer] = useState("");
  const [logTailLines, setLogTailLines] = useState(2_000);
  const [logSinceSeconds, setLogSinceSeconds] = useState("");
  const [logTimestamps, setLogTimestamps] = useState(true);
  const [logPrevious, setLogPrevious] = useState(false);
  const [isFollowingLogs, setIsFollowingLogs] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const logFollowOperationId = useRef<string | null>(null);
  const detailViewRef = useRef<HTMLElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<KubernetesCapabilities | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem(`dssh.kubernetes.autoRefresh.${profile.id}`) === "true");
  const [openContextKeys, setOpenContextKeys] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`dssh.kubernetes.tabs.${profile.id}`) ?? "[]") as unknown;
      const valid = Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
      const initial = contextKey(initialContext ?? profile.selectedContexts[0] ?? { sourceId: "", name: "" });
      return [...new Set([...valid, initial])].filter((key) => profile.selectedContexts.some((item) => contextKey(item) === key));
    } catch { return [contextKey(initialContext ?? profile.selectedContexts[0] ?? { sourceId: "", name: "" })]; }
  });

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

  useEffect(() => {
    setNamespace(context.namespace ?? "");
    setSelectedItem(null);
    setDocument(null);
    setPodLogs(null);
    setLogSearch("");
    setLogContainer("");
    void stopPodLogFollow();
  }, [context]);

  useEffect(() => {
    localStorage.setItem(`dssh.kubernetes.tabs.${profile.id}`, JSON.stringify(openContextKeys));
  }, [openContextKeys, profile.id]);

  useEffect(() => {
    if (!isNamespaced) setNamespace("");
  }, [isNamespaced]);

  async function refresh(append = false) {
    if (!context.name || !context.sourceId) {
      setError("该 Kubernetes 配置尚未选择 context。请先编辑配置并发现 context。");
      return;
    }
    setIsLoading(true);
    setError(null);
    setSelectedItem(null);
    setDocument(null);
    setPodLogs(null);
    setLogSearch("");
    setLogContainer("");
    void stopPodLogFollow();
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
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setContinueToken(result.continueToken ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 Kubernetes 资源失败。 ");
      if (!append) setItems([]);
    } finally {
      setIsLoading(false);
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
    localStorage.setItem(`dssh.kubernetes.autoRefresh.${profile.id}`, String(autoRefresh));
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, context, resource, namespace, labelSelector, profile.id]);

  async function openDocument(item: KubernetesResourceItem) {
    setSelectedItem(item);
    setPodLogs(null);
    setLogSearch("");
    setLogContainer("");
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
        <Button onClick={() => onOpenCli(profile, context)} title="在来源一致的终端中打开 kubectl" type="button" variant="ghost"><Icon name="terminalTool" height="15" width="15" />CLI</Button>
        <label className="kubernetes-workspace__auto-refresh"><input checked={autoRefresh} onChange={(event) => setAutoRefresh(event.currentTarget.checked)} type="checkbox" />自动刷新</label>
        {capabilities ? <span className="kubernetes-workspace__identity" title={`来源：${capabilities.source}`}>{capabilities.username ?? "身份未知"}{capabilities.canListPods === false ? " · 只读受限" : ""}</span> : null}
        <button aria-label="关闭 Kubernetes 工作区" className="icon-button" onClick={onClose} title="关闭工作区" type="button"><Icon name="close" height="16" width="16" /></button>
      </header>
      {error ? <div className="kubernetes-workspace__error" role="alert">{error}</div> : null}
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
          {isLoadingDocument ? <p className="kubernetes-workspace__empty">正在读取资源详情…</p> : document ? <>
            <div className="kubernetes-workspace__detail-head"><strong>{document.item.kind} · {document.item.name}</strong><div>{document.item.kind.toLowerCase() === "pod" ? <Button onClick={() => { setPodLogs(null); void openPodLogs(); }} type="button" variant="ghost">日志</Button> : null}{document.redacted ? <span>敏感数据已隐藏</span> : null}</div></div>
            {isLoadingLogs ? <p className="kubernetes-workspace__empty">正在读取 Pod 日志…</p> : podLogs ? <><div className="kubernetes-workspace__log-controls">{podContainers.length > 1 ? <SelectMenu ariaLabel="Pod 容器" onChange={setLogContainer} options={[{ label: "默认容器", value: "" }, ...podContainers.map((name) => ({ label: name, value: name }))]} value={logContainer} /> : null}<label>最近 <input min="1" max="100000" onChange={(event) => setLogTailLines(Math.max(1, Number(event.currentTarget.value) || 1))} type="number" value={logTailLines} /> 行</label><label>最近 <input min="1" max="31536000" onChange={(event) => setLogSinceSeconds(event.currentTarget.value)} placeholder="全部" type="number" value={logSinceSeconds} /> 秒</label><label><input checked={logTimestamps} onChange={(event) => setLogTimestamps(event.currentTarget.checked)} type="checkbox" />时间戳</label><label><input checked={logPrevious} onChange={(event) => setLogPrevious(event.currentTarget.checked)} type="checkbox" />上次实例</label><input aria-label="搜索日志" className="kubernetes-workspace__log-search" onChange={(event) => setLogSearch(event.currentTarget.value)} placeholder="搜索日志" value={logSearch} /><Button onClick={() => void openPodLogs()} type="button" variant="ghost">刷新</Button><Button onClick={() => void (isFollowingLogs ? stopPodLogFollow() : startPodLogFollow())} type="button" variant="ghost">{isFollowingLogs ? "停止跟随" : "跟随日志"}</Button><Button onClick={() => void downloadPodLogs()} type="button" variant="ghost">下载</Button><Button onClick={() => { void stopPodLogFollow(); setPodLogs(null); }} type="button" variant="ghost">YAML</Button></div><pre className="kubernetes-workspace__logs">{filteredLogContent}</pre>{podLogs.truncated ? <p className="kubernetes-workspace__log-note">日志已按 2 MB 安全上限截断。</p> : null}</> : <pre>{document.yaml}</pre>}
          </> : <p className="kubernetes-workspace__empty">从左侧选择资源查看只读 YAML。</p>}
        </aside>
      </div>
    </section>
  );
}
