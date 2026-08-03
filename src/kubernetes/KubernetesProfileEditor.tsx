import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  KubernetesContextSelection,
  KubernetesContextSummary,
  KubernetesProfile,
  KubernetesSource,
  SshProfile,
} from "../models";
import {
  discoverRemoteKubernetes,
  scanLocalKubeconfig,
  type CreateKubernetesProfileRequest,
} from "../services/kubernetesService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { TagInput } from "../ssh/TagInput";

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
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setDraft(profile ? profileToDraft(profile) : emptyDraft());
    setContexts([]);
    setErrors([]);
  }, [mode, profile]);

  const sourceKind = draft.source.kind;
  const selectedContextKeys = useMemo(
    () => new Set(draft.selectedContexts.map((context) => `${context.sourceId}\u0000${context.name}`)),
    [draft.selectedContexts],
  );

  function updateDraft(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
  }

  function updateSource(source: KubernetesSource) {
    updateDraft({ source, selectedContexts: [] });
    setContexts([]);
    setErrors([]);
  }

  async function chooseKubeconfig() {
    try {
      const selected = await open({
        directory: false,
        filters: [{ extensions: ["yaml", "yml", "config"], name: "Kubeconfig" }],
        multiple: true,
        title: "选择 kubeconfig 文件",
      });
      if (!selected || !Array.isArray(selected) || draft.source.kind !== "local") return;
      updateSource({ kind: "local", kubeconfigPaths: selected });
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "选择 kubeconfig 失败。"]);
    }
  }

  async function discoverContexts() {
    setIsDiscovering(true);
    setErrors([]);
    try {
      if (draft.source.kind === "local") {
        const result = await scanLocalKubeconfig({ paths: draft.source.kubeconfigPaths });
        setContexts(result.contexts);
      } else {
        const result = await discoverRemoteKubernetes(draft.source.sshProfileId, {
          kubeconfigPath: draft.source.kubeconfigPath,
          kubectlPath: draft.source.kubectlPath,
        });
        setContexts(result.candidates.flatMap((candidate) => sourceContexts(candidate.path, candidate.contexts)));
        if (result.warnings.length > 0) setErrors(result.warnings);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "未能发现 Kubernetes context。"]);
    } finally {
      setIsDiscovering(false);
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
    try {
      await onSubmit({
        name: draft.name,
        source: draft.source,
        selectedContexts: draft.selectedContexts,
        favorite: draft.favorite,
        description: draft.description || undefined,
        tags: draft.tags,
      });
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "保存 Kubernetes 连接失败。"]);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="profile-editor profile-editor--connection" aria-label="Kubernetes 连接编辑器">
        <header className="profile-editor__topbar">
          <h2>{mode === "create" ? "新建 Kubernetes 连接" : "编辑 Kubernetes 连接"}</h2>
          <button aria-label="关闭编辑器" className="icon-button" onClick={onClose} type="button">
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
            <label className="field">
              <span>连接来源</span>
              <SelectMenu
                ariaLabel="Kubernetes 连接来源"
                onChange={(value) => updateSource(value === "remote" ? {
                  kind: "remoteSsh", sshProfileId: "", kubeconfigPath: undefined, kubectlPath: undefined,
                } : { kind: "local", kubeconfigPaths: [] })}
                options={[{ label: "本机 kubeconfig", value: "local" }, { label: "远端 SSH", value: "remote" }]}
                value={sourceKind === "remoteSsh" ? "remote" : "local"}
              />
              <small className="profile-form__hint">仅保存文件路径或 SSH 引用，不会将 kubeconfig 的凭据写入应用数据库。</small>
            </label>

            {draft.source.kind === "local" ? (
              <div className="field">
                <span>kubeconfig 文件</span>
                <div className="kubernetes-profile-editor__path-row">
                  <input
                    onChange={(event) => updateSource({
                      kind: "local",
                      kubeconfigPaths: event.currentTarget.value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
                    })}
                    placeholder="留空则使用 KUBECONFIG 或 ~/.kube/config"
                    value={draft.source.kubeconfigPaths.join(", ")}
                  />
                  <Button onClick={chooseKubeconfig} type="button" variant="ghost">选择文件</Button>
                </div>
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
                <label className="field">
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
                </label>
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
              <Button disabled={isDiscovering || (draft.source.kind === "remoteSsh" && !draft.source.sshProfileId)} onClick={() => void discoverContexts()} type="button" variant="ghost">
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
          </div>

          <footer className="profile-editor__footer">
            <Button onClick={onClose} variant="ghost">取消</Button>
            <Button type="submit" variant="primary">{mode === "create" ? "创建配置" : "保存修改"}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
