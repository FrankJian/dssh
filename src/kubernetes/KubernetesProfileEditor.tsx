import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  KubernetesContextSelection,
  KubernetesContextSummary,
  KubernetesConnectionTestResult,
  KubernetesExecPluginSummary,
  KubernetesProfile,
  KubernetesSource,
  SshProfile,
} from "../models";
import {
  discoverRemoteKubernetes,
  discardImportedLocalKubeconfig,
  importLocalKubeconfig,
  scanLocalKubeconfig,
  scanImportedLocalKubeconfig,
  setKubernetesExecPluginTrust,
  testKubernetesConnection,
  type CreateKubernetesProfileRequest,
} from "../services/kubernetesService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { TagInput } from "../ssh/TagInput";
import { sftpHome, sftpList, type SftpEntry } from "../services/sftpService";

export type KubernetesProfileEditorMode = "create" | "edit";

interface KubernetesProfileEditorProps {
  allTags: string[];
  mode: KubernetesProfileEditorMode;
  profile: KubernetesProfile | null;
  sshProfiles: SshProfile[];
  onClose: () => void;
  onSubmit: (request: CreateKubernetesProfileRequest) => Promise<void>;
}

interface Draft {
  name: string;
  source: KubernetesSource;
  selectedContexts: KubernetesContextSelection[];
  favorite: boolean;
  description: string;
  tags: string[];
}

function emptyDraft(): Draft {
  return {
    name: "",
    source: { kind: "local", kubeconfigPaths: [] },
    selectedContexts: [],
    favorite: false,
    description: "",
    tags: [],
  };
}

function profileToDraft(profile: KubernetesProfile): Draft {
  return {
    name: profile.name,
    source: profile.source,
    selectedContexts: profile.selectedContexts,
    favorite: profile.favorite,
    description: profile.description ?? "",
    tags: profile.tags,
  };
}

function sourceContexts(sourceId: string, contexts: KubernetesContextSummary[]) {
  return contexts.map((context) => ({ ...context, sourceId }));
}

export function KubernetesProfileEditor({
  allTags,
  mode,
  onClose,
  onSubmit,
  profile,
  sshProfiles,
}: KubernetesProfileEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => (profile ? profileToDraft(profile) : emptyDraft()));
  const [contexts, setContexts] = useState<KubernetesContextSummary[]>([]);
  const [execPlugins, setExecPlugins] = useState<KubernetesExecPluginSummary[]>([]);
  const [connectionTests, setConnectionTests] = useState<KubernetesConnectionTestResult[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const pendingImportRef = useRef<string | null>(null);
  const [remotePathPicker, setRemotePathPicker] = useState<{
    entries: SftpEntry[];
    error: string | null;
    isLoading: boolean;
    path: string;
  } | null>(null);

  useEffect(() => {
    setDraft(profile ? profileToDraft(profile) : emptyDraft());
    setContexts([]);
    setExecPlugins([]);
    setConnectionTests([]);
    setScanNotice(null);
    setErrors([]);
    pendingImportRef.current = null;
    setRemotePathPicker(null);
  }, [mode, profile]);

  useEffect(() => () => {
    const secretRef = pendingImportRef.current;
    if (secretRef) void discardImportedLocalKubeconfig(secretRef).catch(() => undefined);
  }, []);

  const sourceKind = draft.source.kind;
  const remoteSshProfileId = draft.source.kind === "remoteSsh" ? draft.source.sshProfileId : "";
  const selectedContextKeys = useMemo(
    () => new Set(draft.selectedContexts.map((context) => `${context.sourceId}\u0000${context.name}`)),
    [draft.selectedContexts],
  );

  function updateDraft(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
  }

  function updateSource(source: KubernetesSource) {
    const pendingImport = pendingImportRef.current;
    if (pendingImport && (source.kind !== "localImported" || source.secretRef !== pendingImport)) {
      pendingImportRef.current = null;
      void discardImportedLocalKubeconfig(pendingImport).catch(() => undefined);
    }
    updateDraft({ source, selectedContexts: [] });
    setContexts([]);
    setExecPlugins([]);
    setConnectionTests([]);
    setScanNotice(null);
    setErrors([]);
  }

  async function chooseKubeconfig() {
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: "选择 kubeconfig 文件（支持无扩展名）",
      });
      if (!selected || draft.source.kind !== "local") return;
      const paths = Array.isArray(selected) ? selected : [selected];
      updateSource({ kind: "local", kubeconfigPaths: paths });
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "选择 kubeconfig 失败。"]);
    }
  }

  async function importKubeconfig() {
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: "选择要安全导入的 kubeconfig 文件",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const imported = await importLocalKubeconfig(paths);
      updateSource(imported.source);
      pendingImportRef.current = imported.source.secretRef;
      applyDiscoveredContexts(imported.scan.contexts);
      setExecPlugins(imported.scan.execPlugins);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "无法安全导入 kubeconfig。"]);
    }
  }

  async function browseRemoteKubeconfig(profileId: string, path?: string) {
    setRemotePathPicker((current) => ({
      entries: current?.entries ?? [], error: null, isLoading: true, path: path ?? current?.path ?? "",
    }));
    try {
      const targetPath = path ?? await sftpHome(profileId);
      const listing = await sftpList(profileId, targetPath);
      setRemotePathPicker({ entries: listing.entries, error: null, isLoading: false, path: listing.path });
    } catch (error) {
      setRemotePathPicker((current) => ({
        entries: current?.entries ?? [],
        error: error instanceof Error ? error.message : "无法读取远端目录。",
        isLoading: false,
        path: path ?? current?.path ?? "",
      }));
    }
  }

  function selectRemoteKubeconfig(entry: SftpEntry) {
    if (entry.isDir) {
      if (draft.source.kind === "remoteSsh") void browseRemoteKubeconfig(draft.source.sshProfileId, entry.path);
      return;
    }
    if (draft.source.kind !== "remoteSsh") return;
    updateSource({ ...draft.source, kubeconfigPath: entry.path });
    setRemotePathPicker(null);
  }

  async function discoverContexts() {
    setIsDiscovering(true);
    setErrors([]);
    try {
      if (draft.source.kind === "local") {
        const result = await scanLocalKubeconfig({ paths: draft.source.kubeconfigPaths });
        applyDiscoveredContexts(result.contexts);
        setExecPlugins(result.execPlugins);
      } else if (draft.source.kind === "localImported") {
        if (!draft.source.secretRef) throw new Error("请先选择并安全导入 kubeconfig 文件。");
        const result = await scanImportedLocalKubeconfig(draft.source);
        applyDiscoveredContexts(result.contexts);
        setExecPlugins(result.execPlugins);
      } else {
        const result = await discoverRemoteKubernetes(draft.source.sshProfileId, {
          kubeconfigPath: draft.source.kubeconfigPath,
          kubectlPath: draft.source.kubectlPath,
        });
        applyDiscoveredContexts(result.candidates.flatMap((candidate) => sourceContexts(candidate.path, candidate.contexts)));
        if (result.warnings.length > 0) setErrors(result.warnings);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "未能发现 Kubernetes context。"]);
    } finally {
      setIsDiscovering(false);
    }
  }

  function applyDiscoveredContexts(nextContexts: KubernetesContextSummary[]) {
    const nextKeys = new Set(nextContexts.map((context) => `${context.sourceId}\u0000${context.name}`));
    const priorKeys = new Set(contexts.map((context) => `${context.sourceId}\u0000${context.name}`));
    const removed = draft.selectedContexts.filter((context) => !nextKeys.has(`${context.sourceId}\u0000${context.name}`));
    const addedCount = [...nextKeys].filter((key) => !priorKeys.has(key)).length;
    const notices: string[] = [];
    if (removed.length > 0) notices.push(`${removed.length} 个已选择的 context 已不在当前配置中，未自动切换或移除。`);
    if (addedCount > 0 && priorKeys.size > 0) notices.push(`发现 ${addedCount} 个新增 context。`);
    setContexts(nextContexts);
    setConnectionTests([]);
    setScanNotice(notices.length > 0 ? notices.join(" ") : null);
  }

  async function updateExecPluginTrust(plugin: KubernetesExecPluginSummary, trusted: boolean) {
    setErrors([]);
    try {
      await setKubernetesExecPluginTrust(plugin.fingerprint, trusted);
      setExecPlugins((current) => current.map((item) => (
        item.fingerprint === plugin.fingerprint ? { ...item, trusted } : item
      )));
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "无法更新认证插件信任状态。"]);
    }
  }

  async function testContexts() {
    if (draft.selectedContexts.length === 0) {
      setErrors(["请先选择至少一个 context，再测试连接。"]);
      return;
    }
    setIsTesting(true);
    setErrors([]);
    try {
      setConnectionTests(await testKubernetesConnection(draft.source, draft.selectedContexts));
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Kubernetes 连接测试失败。"]);
    } finally {
      setIsTesting(false);
    }
  }

  function toggleContext(context: KubernetesContextSummary) {
    const key = `${context.sourceId}\u0000${context.name}`;
    setDraft((current) => ({
      ...current,
      selectedContexts: selectedContextKeys.has(key)
        ? current.selectedContexts.filter((item) => `${item.sourceId}\u0000${item.name}` !== key)
        : [...current.selectedContexts, {
            sourceId: context.sourceId,
            name: context.name,
            namespace: context.namespace,
            user: context.user,
          }],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setErrors(["请输入 Kubernetes 连接名称。"]);
      return;
    }
    if (draft.source.kind === "remoteSsh" && !draft.source.sshProfileId) {
      setErrors(["请选择远端来源的 SSH 连接。"]);
      return;
    }
    if (draft.source.kind === "localImported" && !draft.source.secretRef) {
      setErrors(["请先选择并安全导入 kubeconfig 文件。"]);
      return;
    }
    try {
      await onSubmit({
        name: draft.name,
        source: draft.source,
        selectedContexts: draft.selectedContexts,
        favorite: draft.favorite,
        description: draft.description || undefined,
        tags: draft.tags,
      });
      pendingImportRef.current = null;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "保存 Kubernetes 连接失败。"]);
    }
  }

  function closeEditor() {
    const pendingImport = pendingImportRef.current;
    pendingImportRef.current = null;
    if (pendingImport) void discardImportedLocalKubeconfig(pendingImport).catch(() => undefined);
    onClose();
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="profile-editor profile-editor--connection" aria-label="Kubernetes 连接编辑器">
        <header className="profile-editor__topbar">
          <h2>{mode === "create" ? "新建 Kubernetes 连接" : "编辑 Kubernetes 连接"}</h2>
          <button aria-label="关闭编辑器" className="icon-button" onClick={closeEditor} type="button">
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        <form className="profile-form profile-form--connection" onSubmit={handleSubmit}>
          {errors.length > 0 ? <div className="form-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
          <aside className="profile-form__sidebar">
            <label className="field">
              <span>名称</span>
              <input autoFocus onChange={(event) => updateDraft({ name: event.currentTarget.value })} value={draft.name} />
            </label>
            <div className="field">
              <span>分组（标签）</span>
              <TagInput onChange={(tags) => updateDraft({ tags })} suggestions={allTags} value={draft.tags} />
            </div>
            <label className="field">
              <span>描述</span>
              <textarea onChange={(event) => updateDraft({ description: event.currentTarget.value })} rows={3} value={draft.description} />
            </label>
            <label className="checkbox-field">
              <input checked={draft.favorite} onChange={(event) => updateDraft({ favorite: event.currentTarget.checked })} type="checkbox" />
              设为收藏
            </label>
          </aside>

          <div className="profile-form__main">
            <div className="field">
              <span>连接来源</span>
              <SelectMenu
                ariaLabel="Kubernetes 连接来源"
                onChange={(value) => updateSource(value === "remote" ? {
                  kind: "remoteSsh", sshProfileId: "", kubeconfigPath: undefined, kubectlPath: undefined,
                } : value === "imported" ? { kind: "localImported", secretRef: "", displayNames: [] } : { kind: "local", kubeconfigPaths: [] })}
                options={[
                  { label: "本机路径引用", value: "local" },
                  { label: "安全导入到系统凭据存储", value: "imported" },
                  { label: "远端 SSH", value: "remote" },
                ]}
                value={sourceKind === "remoteSsh" ? "remote" : sourceKind === "localImported" ? "imported" : "local"}
              />
              <small className="profile-form__hint">路径模式仅保存文件引用；安全导入模式将 kubeconfig 保存到 macOS Keychain 或 Windows Credential Manager，不写入应用数据库。</small>
            </div>

            {draft.source.kind === "local" || draft.source.kind === "localImported" ? (
              <div className="field">
                <span>kubeconfig 文件</span>
                {draft.source.kind === "local" ? <div className="kubernetes-profile-editor__path-row">
                  <input
                    onChange={(event) => updateSource({
                      kind: "local",
                      kubeconfigPaths: event.currentTarget.value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
                    })}
                    placeholder="留空则使用 KUBECONFIG 或 ~/.kube/config"
                    value={draft.source.kubeconfigPaths.join(", ")}
                  />
                  <Button onClick={chooseKubeconfig} type="button" variant="ghost">选择文件</Button>
                </div> : <div className="kubernetes-profile-editor__path-row">
                  <input aria-label="已安全导入的 kubeconfig" readOnly value={draft.source.displayNames.length > 0 ? draft.source.displayNames.join("、") : "尚未选择文件"} />
                  <Button onClick={() => void importKubeconfig()} type="button" variant="ghost">选择并导入</Button>
                </div>}
                {draft.source.kind === "localImported" ? <small className="profile-form__hint">仅支持内嵌证书、私钥或 Token 的 kubeconfig；外部敏感文件引用请使用路径模式。</small> : null}
              </div>
            ) : (
              <>
                <label className="field">
                  <span>SSH 来源</span>
                  <SelectMenu
                    ariaLabel="远端 SSH 来源"
                    disabled={sshProfiles.length === 0}
                    onChange={(sshProfileId) => updateSource({
                      kind: "remoteSsh",
                      sshProfileId,
                      kubeconfigPath: draft.source.kind === "remoteSsh" ? draft.source.kubeconfigPath : undefined,
                      kubectlPath: draft.source.kind === "remoteSsh" ? draft.source.kubectlPath : undefined,
                    })}
                    options={sshProfiles.length > 0
                      ? sshProfiles.map((item) => ({ label: `${item.name} · ${item.username}@${item.host}`, value: item.id }))
                      : [{ disabled: true, label: "暂无 SSH 连接", value: "" }]}
                    value={draft.source.sshProfileId}
                  />
                </label>
                <div className="field">
                  <span>远端 kubeconfig（可选）</span>
                  <input
                    onChange={(event) => updateSource({
                      kind: "remoteSsh",
                      sshProfileId: draft.source.kind === "remoteSsh" ? draft.source.sshProfileId : "",
                      kubeconfigPath: event.currentTarget.value || undefined,
                      kubectlPath: draft.source.kind === "remoteSsh" ? draft.source.kubectlPath : undefined,
                    })}
                    placeholder="留空则自动发现常见路径"
                    value={draft.source.kubeconfigPath ?? ""}
                  />
                  <Button disabled={!remoteSshProfileId} onClick={() => void browseRemoteKubeconfig(remoteSshProfileId)} type="button" variant="ghost">选择远端文件</Button>
                  {remotePathPicker ? <section className="kubernetes-profile-editor__remote-picker" aria-label="选择远端 kubeconfig">
                    <div className="kubernetes-profile-editor__remote-picker-head"><strong>远端目录</strong><Button onClick={() => setRemotePathPicker(null)} type="button" variant="ghost">关闭</Button></div>
                    <div className="kubernetes-profile-editor__remote-picker-path"><input aria-label="远端目录路径" onChange={(event) => setRemotePathPicker((current) => current ? { ...current, path: event.currentTarget.value } : current)} value={remotePathPicker.path} /><Button disabled={remotePathPicker.isLoading || !remotePathPicker.path.trim() || !remoteSshProfileId} onClick={() => void browseRemoteKubeconfig(remoteSshProfileId, remotePathPicker.path)} type="button" variant="ghost">转到</Button></div>
                    {remotePathPicker.error ? <p className="form-errors">{remotePathPicker.error}</p> : null}
                    {remotePathPicker.isLoading ? <p className="profile-form__hint">正在读取远端目录…</p> : <div className="kubernetes-profile-editor__remote-picker-entries">{remotePathPicker.entries.filter((entry) => entry.isDir || /\.(?:yaml|yml|config)$/i.test(entry.name) || entry.name === "config").map((entry) => <button key={entry.path} onClick={() => selectRemoteKubeconfig(entry)} title={entry.path} type="button"><Icon name={entry.isDir ? "folder" : "file"} height="15" width="15" /><span>{entry.name}</span>{entry.isDir ? <small>目录</small> : null}</button>)}</div>}
                  </section> : null}
                </div>
                <label className="field">
                  <span>远端 kubectl（可选）</span>
                  <input
                    onChange={(event) => updateSource({
                      kind: "remoteSsh",
                      sshProfileId: draft.source.kind === "remoteSsh" ? draft.source.sshProfileId : "",
                      kubeconfigPath: draft.source.kind === "remoteSsh" ? draft.source.kubeconfigPath : undefined,
                      kubectlPath: event.currentTarget.value || undefined,
                    })}
                    placeholder="留空则从 PATH 自动发现"
                    value={draft.source.kubectlPath ?? ""}
                  />
                </label>
              </>
            )}

            <div className="kubernetes-profile-editor__contexts-header">
              <div><strong>Contexts</strong><small>支持从同一个 kubeconfig 选择多个 context。</small></div>
              <Button disabled={isDiscovering || (draft.source.kind === "remoteSsh" && !draft.source.sshProfileId) || (draft.source.kind === "localImported" && !draft.source.secretRef)} onClick={() => void discoverContexts()} type="button" variant="ghost">
                <Icon name="refresh" height="14" width="14" />
                {isDiscovering ? "读取中…" : "发现 context"}
              </Button>
            </div>
            {contexts.length > 0 ? (
              <div className="kubernetes-profile-editor__contexts">
                {contexts.map((context) => {
                  const key = `${context.sourceId}\u0000${context.name}`;
                  return <label className="kubernetes-profile-editor__context" key={key}>
                    <input checked={selectedContextKeys.has(key)} onChange={() => toggleContext(context)} type="checkbox" />
                    <span><strong>{context.name}</strong><small>{context.cluster}{context.namespace ? ` · ${context.namespace}` : ""}{context.isCurrent ? " · 当前" : ""}</small></span>
                  </label>;
                })}
              </div>
            ) : <p className="profile-form__hint">发现后在此选择要保存并展示的 context。</p>}
            {scanNotice ? <p className="kubernetes-profile-editor__scan-notice" role="status">{scanNotice}</p> : null}

            {execPlugins.length > 0 ? (
              <section className="kubernetes-profile-editor__exec-plugins" aria-label="认证插件安全">
                <div>
                  <strong>认证插件安全</strong>
                  <small>认证插件可执行本机程序。只有明确批准后，Duo SSH 才会使用它获取凭据。</small>
                </div>
                {execPlugins.map((plugin) => (
                  <div className="kubernetes-profile-editor__exec-plugin" key={plugin.fingerprint}>
                    <span>
                      <strong>{plugin.contextName}</strong>
                      <small>{plugin.command} · {plugin.argumentsSummary}</small>
                      {plugin.environmentVariableNames.length > 0 ? (
                        <small>允许的环境变量：{plugin.environmentVariableNames.join("、")}</small>
                      ) : null}
                    </span>
                    <Button
                      onClick={() => void updateExecPluginTrust(plugin, !plugin.trusted)}
                      type="button"
                      variant={plugin.trusted ? "ghost" : "primary"}
                    >
                      {plugin.trusted ? "撤销信任" : "信任插件"}
                    </Button>
                  </div>
                ))}
              </section>
            ) : null}

            <section className="kubernetes-profile-editor__connection-test" aria-label="测试 Kubernetes 连接">
              <div>
                <strong>测试连接</strong>
                <small>逐个检查选中的 context；单个失败不会影响保存其他 context。</small>
              </div>
              <Button disabled={isTesting || draft.selectedContexts.length === 0} onClick={() => void testContexts()} type="button" variant="ghost">
                <Icon name="refresh" height="14" width="14" />
                {isTesting ? "测试中…" : "测试连接"}
              </Button>
              {connectionTests.length > 0 ? <div className="kubernetes-profile-editor__connection-test-results">
                {connectionTests.map((result) => <p data-status={result.success ? "success" : "error"} key={`${result.context.sourceId}\u0000${result.context.name}`}>
                  <strong>{result.context.name}</strong>
                  <span>{result.success
                    ? `${result.username ?? "已连接"}${result.version ? ` · ${result.version}` : ""} · ${result.canListPods === true ? "可列出 Pod" : "Pod 列表权限未知"}`
                    : result.message}</span>
                </p>)}
              </div> : null}
            </section>
          </div>

          <footer className="profile-editor__footer">
            <Button onClick={closeEditor} variant="ghost">取消</Button>
            <Button type="submit" variant="primary">{mode === "create" ? "创建配置" : "保存修改"}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
