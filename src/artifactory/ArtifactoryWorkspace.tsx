import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { Button } from "../ui/Button";
import { Breadcrumbs } from "../ui/Breadcrumbs";
import { WorkspaceToolbar } from "../ui/WorkspaceToolbar";
import { toast } from "../ui/ToastHost";
import { useConfirmation } from "../ui/useConfirmation";
import {
  artifactoryItemInfo, artifactoryListFolder, artifactoryRepositories,
  cancelArtifactoryTransfer, clearArtifactoryTransfers, deleteArtifactoryProfile,
  deleteArtifactoryProperty, enqueueArtifactoryTransfer, listArtifactoryProfiles,
  listArtifactoryTransfers, onArtifactoryTransfer, retryArtifactoryTransfer,
  saveArtifactoryProfile, setArtifactoryProperty,
  type ArtifactoryChild, type ArtifactoryItemInfo, type ArtifactoryProfile,
  type ArtifactoryRepository, type ArtifactoryTransfer,
} from "../services/artifactoryService";
import { ArtifactoryDetails } from "./ArtifactoryDetails";
import { ArtifactoryPropertyDialog } from "./ArtifactoryPropertyDialog";
import { ArtifactoryTransferQueue } from "./ArtifactoryTransferQueue";
import "./artifactory.css";

function message(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
function nameOf(child: ArtifactoryChild) {
  const raw = child.uri.replace(/^\//, "");
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export function ArtifactoryWorkspace() {
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [profiles, setProfiles] = useState<ArtifactoryProfile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [editor, setEditor] = useState<ArtifactoryProfile | "new" | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repos, setRepos] = useState<ArtifactoryRepository[]>([]);
  const [repo, setRepo] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [children, setChildren] = useState<ArtifactoryChild[]>([]);
  const [selected, setSelected] = useState<ArtifactoryChild | null>(null);
  const [details, setDetails] = useState<ArtifactoryItemInfo | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<ArtifactoryTransfer[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [propertyEditor, setPropertyEditor] = useState<{ key: string; values: string[] } | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const repoRequestId = useRef(0);
  const folderRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const locationRef = useRef({ active, repo, path });
  locationRef.current = { active, repo, path };

  useEffect(() => {
    let disposed = false;
    const listener = onArtifactoryTransfer((task) => {
      if (disposed) return;
      setTasks((current) => current.some((item) => item.id === task.id)
        ? current.map((item) => item.id === task.id ? task : item)
        : [...current, task]);
      const location = locationRef.current;
      if (task.kind === "upload" && task.status === "completed" && task.profileId === location.active && task.repo === location.repo && task.path.startsWith(location.path) && !task.path.slice(location.path.length).includes("/")) {
        void artifactoryListFolder(task.profileId, task.repo, location.path).then((folder) => {
          const current = locationRef.current;
          if (!disposed && current.active === location.active && current.repo === location.repo && current.path === location.path) setChildren(folder.children ?? []);
        }).catch(() => {});
      }
    });
    void listener.then(() => listArtifactoryTransfers()).then((items) => {
      if (!disposed) setTasks((current) => [...items.filter((item) => !current.some((live) => live.id === item.id)), ...current]);
    }).catch(() => {});
    return () => { disposed = true; void listener.then((dispose) => dispose()); };
  }, []);

  useEffect(() => { void listArtifactoryProfiles().then(setProfiles).catch((reason) => setError(message(reason))); }, []);
  useEffect(() => {
    const id = ++repoRequestId.current;
    setRepos([]); setRepo(null); setChildren([]); setSelected(null); setDetails(null); setError(null);
    if (!active) return;
    setBusy(true);
    void artifactoryRepositories(active).then((items) => { if (id === repoRequestId.current) setRepos(items); })
      .catch((reason) => { if (id === repoRequestId.current) setError(message(reason)); })
      .finally(() => { if (id === repoRequestId.current) setBusy(false); });
  }, [active, profileVersion]);
  useEffect(() => {
    const id = ++folderRequestId.current;
    setChildren([]); setSelected(null); setDetails(null); setError(null);
    if (!active || !repo) return;
    setBusy(true);
    void artifactoryListFolder(active, repo, path).then((folder) => {
      if (id === folderRequestId.current) setChildren(folder.children ?? []);
    }).catch((reason) => { if (id === folderRequestId.current) setError(message(reason)); })
      .finally(() => { if (id === folderRequestId.current) setBusy(false); });
  }, [active, repo, path]);
  useEffect(() => {
    const id = ++detailRequestId.current;
    setDetails(null);
    if (!active || !repo || !selected) return;
    void artifactoryItemInfo(active, repo, `${path}${nameOf(selected)}`).then((info) => {
      if (id === detailRequestId.current) setDetails(info);
    }).catch((reason) => { if (id === detailRequestId.current) toast(message(reason), "error"); });
  }, [active, repo, path, selected]);

  const currentProfile = profiles.find((item) => item.id === active);
  const currentRepo = repos.find((item) => item.key === repo);
  const canWriteProperties = Boolean(currentRepo && (currentRepo.type.toLowerCase() === "local" || currentRepo.key.endsWith("-cache")));
  const canArchive = canWriteProperties;
  const activeTaskCount = tasks.filter((task) => task.status === "queued" || task.status === "running").length;
  const visibleRepos = useMemo(() => repos.filter((item) => item.key.toLowerCase().includes(filter.toLowerCase())), [repos, filter]);
  const sortedChildren = useMemo(() => [...children].sort((a, b) => Number(b.folder) - Number(a.folder) || nameOf(a).localeCompare(nameOf(b))), [children]);

  function edit(profile: ArtifactoryProfile | "new") {
    setEditor(profile);
    setName(profile === "new" ? "" : profile.name);
    setBaseUrl(profile === "new" ? "" : profile.baseUrl);
    setToken("");
    setTokenVisible(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await saveArtifactoryProfile({ id: editor === "new" ? undefined : editor?.id, name, baseUrl, token: token || undefined });
      setProfiles(await listArtifactoryProfiles());
      setEditor(null); setActive(saved.id); setProfileVersion((version) => version + 1);
      toast("Artifactory 连接已保存。", "success");
    } catch (reason) { toast(message(reason), "error"); }
    finally { setSaving(false); }
  }
  async function remove(profile: ArtifactoryProfile) {
    if (!await requestConfirmation({ title: "删除 Artifactory 连接？", message: `删除连接“${profile.name}”？仓库文件不会被删除。`, confirmLabel: "删除连接", destructive: true })) return;
    try {
      await deleteArtifactoryProfile(profile.id);
      setProfiles((items) => items.filter((item) => item.id !== profile.id));
      setActive((current) => current === profile.id ? null : current);
    } catch (reason) { toast(message(reason), "error"); }
  }
  function enterRepo(key: string) { setRepo(key); setPath(""); }
  function enterFolder(child: ArtifactoryChild) { setPath(`${path}${nameOf(child)}/`); }
  function parent() { setPath((value) => value.replace(/[^/]+\/$/, "")); }
  async function refresh() {
    if (!active || !repo) return;
    setBusy(true);
    setError(null);
    try { setChildren((await artifactoryListFolder(active, repo, path)).children ?? []); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  async function retryRepositories() {
    if (!active) return;
    setBusy(true); setError(null);
    try { setRepos(await artifactoryRepositories(active)); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!active || !repo) return;
    const selection = await open({ multiple: true, title: "选择上传到 Artifactory 的文件" });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    for (const localPath of paths) {
      const fileName = localPath.split(/[\\/]/).pop();
      if (!fileName) continue;
      if (children.some((item) => nameOf(item) === fileName) && !await requestConfirmation({
        title: "覆盖远端文件？", message: `“${fileName}”已存在。继续上传将覆盖远端文件。`, confirmLabel: "覆盖并上传", cancelLabel: "跳过", destructive: true,
      })) continue;
      try { await enqueueArtifactoryTransfer({ profileId: active, repo, path: `${path}${fileName}`, localPath, kind: "upload" }); setQueueOpen(true); }
      catch (reason) { toast(`${fileName}：${message(reason)}`, "error"); }
    }
  }
  async function download(target: ArtifactoryChild | null = selected, currentDirectory = false) {
    if (!active || !repo) return;
    const isFolder = currentDirectory || Boolean(target?.folder);
    if (!target && !currentDirectory) return;
    if (isFolder && !canArchive) { toast("目录归档下载仅支持本地或缓存仓库，且服务器需启用 Folder Download。", "error"); return; }
    const targetPath = currentDirectory ? path.replace(/\/$/, "") : `${path}${nameOf(target!)}`;
    const filename = currentDirectory ? (path.split("/").filter(Boolean).slice(-1)[0] ?? repo) : nameOf(target!);
    const destination = await save({ defaultPath: isFolder ? `${filename}.zip` : filename, title: isFolder ? "保存目录 ZIP" : "保存 Artifactory 文件" });
    if (!destination) return;
    try { await enqueueArtifactoryTransfer({ profileId: active, repo, path: targetPath, localPath: destination, kind: isFolder ? "archive" : "download" }); setQueueOpen(true); }
    catch (reason) { toast(message(reason), "error"); }
  }
  async function retryTask(task: ArtifactoryTransfer) {
    const overwrite = Boolean(task.error?.includes("本地文件已存在") && await requestConfirmation({
      title: "覆盖本地文件？", message: `本地“${task.name}”已存在。覆盖此文件？`, confirmLabel: "覆盖并重试", destructive: true,
    }));
    if (task.error?.includes("本地文件已存在") && !overwrite) return;
    try { await retryArtifactoryTransfer(task.id, overwrite); setQueueOpen(true); }
    catch (reason) { toast(message(reason), "error"); }
  }
  async function changeProperty(key: string, values: string[]) {
    if (!active || !repo || !selected) return;
    const itemPath = `${path}${nameOf(selected)}`;
    await setArtifactoryProperty(active, repo, itemPath, key, values);
    setDetails(await artifactoryItemInfo(active, repo, itemPath));
    toast("属性已保存。", "success");
  }
  async function removeProperty(key: string) {
    if (!active || !repo || !selected) return;
    const itemPath = `${path}${nameOf(selected)}`;
    await deleteArtifactoryProperty(active, repo, itemPath, key);
    setDetails(await artifactoryItemInfo(active, repo, itemPath));
    toast("属性已移除。", "success");
  }

  return <div className="artifactory-surface"><section className="artifactory-workspace" aria-label="Artifactory 工作台">
    <aside className="artifactory-sidebar">
      <div className="artifactory-sidebar__head"><span><Icon name="database" />Artifactory</span><button aria-label="添加 Artifactory 连接" onClick={() => edit("new")} title="添加连接" type="button"><Icon name="plus" /></button></div>
      <div className="artifactory-sidebar__section">连接</div>
      {profiles.map((profile) => <div className={`artifactory-profile${active === profile.id ? " is-active" : ""}`} key={profile.id}>
        <button className="artifactory-profile__open" onClick={() => setActive(profile.id)} type="button"><Icon name="database" /><span>{profile.name}<small>{profile.baseUrl}</small></span></button>
        <button aria-label={`编辑 ${profile.name}`} onClick={() => edit(profile)} title="编辑" type="button"><Icon name="edit" /></button>
        <button aria-label={`删除 ${profile.name}`} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); void remove(profile); }} title="删除" type="button"><Icon name="trash" /></button>
      </div>)}
      {!profiles.length && <p className="artifactory-sidebar__empty">暂无连接</p>}
      {active && <><div className="artifactory-sidebar__section">仓库 <span>{repos.length}</span></div>
        <input aria-label="筛选仓库" className="artifactory-input" onChange={(event) => setFilter(event.target.value)} placeholder="筛选仓库…" value={filter} />
        <div className="artifactory-repolist">{visibleRepos.map((item) => <button className={repo === item.key ? "is-active" : ""} key={item.key} onClick={() => enterRepo(item.key)} title={item.description || item.key} type="button"><Icon name="folder" /><span>{item.key}</span><small>{item.type}</small></button>)}</div>
      </>}
    </aside>
    <div className="artifactory-main">
      <WorkspaceToolbar label="Artifactory 浏览器" identity={
        <><Icon name="database" width="18" height="18" /><div className="artifactory-heading"><strong>{currentRepo?.key ?? currentProfile?.name ?? "Artifactory"}</strong><span>{currentRepo ? `${currentRepo.type} · ${currentRepo.packageType}` : currentProfile?.baseUrl}</span></div></>
      }>
          {repo && <>
            <IconButton disabled={busy} onClick={() => void refresh()} label="刷新目录"><Icon name="refresh" width="16" height="16" /></IconButton>
            <Button onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); void upload(); }} variant="ghost"><Icon name="upload" width="16" height="16" />上传</Button>
            <Button disabled={!selected || (selected.folder && !canArchive)} onClick={() => void download()} variant="ghost"><Icon name="download" width="16" height="16" />下载</Button>
            <IconButton disabled={!canArchive} onClick={() => void download(null, true)} label={canArchive ? "下载当前目录为 ZIP" : "仅本地或缓存仓库支持目录 ZIP"}><Icon name="fileArchive" width="16" height="16" /></IconButton>
          </>}
          <Button aria-expanded={queueOpen} onClick={() => setQueueOpen((value) => !value)} variant="ghost"><Icon name="stackedHexagon" width="16" height="16" />传输{activeTaskCount > 0 ? ` ${activeTaskCount}` : ""}</Button>
      </WorkspaceToolbar>
      {error && <div className="artifactory-error" role="alert">{error}<button onClick={() => { if (repo) void refresh(); else void retryRepositories(); }} type="button">重试</button></div>}
      {!active ? <div className="artifactory-welcome"><div className="artifactory-welcome__icon"><Icon name="database" /></div><div className="artifactory-welcome__body"><span className="artifactory-welcome__eyebrow">开始使用</span><h2>添加 Artifactory 连接</h2><p>输入 JFrog Platform 地址和 Access Token，即可浏览仓库、查看文件属性并上传或下载构件。</p><button onClick={() => edit("new")} type="button"><Icon name="plus" />添加连接</button></div></div>
        : !repo ? <div className="artifactory-welcome"><div className="artifactory-welcome__icon"><Icon name="folder" /></div><div className="artifactory-welcome__body"><span className="artifactory-welcome__eyebrow">{currentProfile?.name}</span><h2>{busy ? "正在读取仓库" : "选择一个仓库"}</h2><p>{busy ? "仓库列表加载中…" : "在左侧选择仓库，浏览其中的目录和文件。"}</p></div></div>
        : <div className="artifactory-content"><div className="artifactory-browser">
          <Breadcrumbs label="仓库路径" items={[
            { id: "repository", label: repo, onClick: () => setPath("") },
            ...path.split("/").filter(Boolean).map((part, index, all) => {
              const target = `${all.slice(0, index + 1).join("/")}/`;
              return { id: target, label: part, onClick: () => setPath(target) };
            }),
          ]} />
          <div className="artifactory-listhead"><span>名称</span><span>类型</span></div>
          <div className="artifactory-list" role="listbox" aria-label="仓库文件">{path && <button className="artifactory-row" onClick={parent} type="button"><Icon name="arrowLeft" /><span>返回上一级</span></button>}{sortedChildren.map((child) => <button aria-selected={selected?.uri === child.uri} className={`artifactory-row${selected?.uri === child.uri ? " is-selected" : ""}`} key={child.uri} onClick={() => setSelected(child)} onDoubleClick={() => child.folder ? enterFolder(child) : void download(child)} role="option" type="button"><Icon name={child.folder ? "folder" : "file"} /><span>{nameOf(child)}</span><small>{child.folder ? "目录" : "文件"}</small></button>)}{!busy && !children.length && <p className="artifactory-muted">此目录为空。</p>}{busy && <p className="artifactory-muted">正在加载…</p>}</div>
        </div><ArtifactoryDetails
          canDownload={!selected?.folder || canArchive}
          canEditProperties={canWriteProperties}
          details={details}
          name={selected ? nameOf(selected) : ""}
          onAddProperty={() => setPropertyEditor("new")}
          onDownload={() => void download()}
          onClose={() => setSelected(null)}
          onEditProperty={(key, values) => setPropertyEditor({ key, values })}
          path={path}
          repo={repo}
          selected={selected}
        /></div>}
      {queueOpen && <ArtifactoryTransferQueue
        tasks={tasks}
        onCancel={(id) => void cancelArtifactoryTransfer(id).catch((reason) => toast(message(reason), "error"))}
        onRetry={(task) => void retryTask(task)}
        onClear={() => void clearArtifactoryTransfers().then(() => setTasks((current) => current.filter((task) => task.status === "queued" || task.status === "running"))).catch((reason) => toast(message(reason), "error"))}
        onClose={() => setQueueOpen(false)}
      />}
    </div>
    {propertyEditor && selected && <ArtifactoryPropertyDialog
      initial={propertyEditor === "new" ? undefined : propertyEditor}
      itemName={nameOf(selected)}
      onClose={() => setPropertyEditor(null)}
      onSave={changeProperty}
      onDelete={removeProperty}
    />}
    {editor && (
      <div className="profile-editor-backdrop" role="presentation">
        <form
          aria-label={editor === "new" ? "添加 Artifactory 连接" : "编辑 Artifactory 连接"}
          aria-modal="true"
          className="profile-editor artifactory-editor is-glass-overlay"
          onKeyDown={(event) => { if (event.key === "Escape") setEditor(null); }}
          onSubmit={(event) => void submit(event)}
          role="dialog"
        >
          <header className="artifactory-editor__header">
            <div className="artifactory-editor__title">
              <span className="artifactory-editor__mark"><Icon name="database" /></span>
              <div>
                <h2>{editor === "new" ? "添加 Artifactory 连接" : "编辑 Artifactory 连接"}</h2>
                <p>使用 JFrog Access Token 访问构件仓库</p>
              </div>
            </div>
            <button aria-label="关闭对话框" className="artifactory-editor__close" onClick={() => setEditor(null)} type="button"><Icon name="close" /></button>
          </header>
          <div className="artifactory-editor__body">
            <div className="artifactory-editor__section-title">连接信息</div>
            <label className="artifactory-editor__field">
              <span>连接名称</span>
              <input autoFocus onChange={(event) => setName(event.target.value)} placeholder="例如：生产构件库" required value={name} />
            </label>
            <label className="artifactory-editor__field">
              <span>JFrog Platform URL</span>
              <input onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.jfrog.io" required type="url" value={baseUrl} />
              <small>填写平台地址，也可使用以 /artifactory 结尾的地址。</small>
            </label>
            <div className="artifactory-editor__field">
              <label htmlFor="artifactory-access-token">Access Token</label>
              <span className="artifactory-editor__secret">
                <input autoComplete="off" id="artifactory-access-token" onChange={(event) => setToken(event.target.value)} placeholder={editor === "new" ? "输入 Access Token" : "留空则保留原 Token"} required={editor === "new"} type={tokenVisible ? "text" : "password"} value={token} />
                <button aria-label={tokenVisible ? "隐藏 Token" : "显示 Token"} onClick={() => setTokenVisible((value) => !value)} type="button">{tokenVisible ? "隐藏" : "显示"}</button>
              </span>
            </div>
            {baseUrl.trim().toLowerCase().startsWith("http://") && <p className="artifactory-editor__warning">HTTP 不加密，请仅在可信网络中使用。</p>}
          </div>
          <footer className="profile-editor__footer artifactory-editor__footer">
            <span>Token 不会显示在连接列表中</span>
            <div>
              <button className="button button--ghost" disabled={saving} onClick={() => setEditor(null)} type="button">取消</button>
              <button className="button button--primary" disabled={saving} type="submit">{saving ? "保存中…" : "保存连接"}</button>
            </div>
          </footer>
        </form>
      </div>
    )}
    {confirmationDialog}
  </section></div>;
}
