import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/ToastHost";
import {
  artifactoryDownload, artifactoryItemInfo, artifactoryListFolder, artifactoryRepositories,
  artifactoryUpload, deleteArtifactoryProfile, listArtifactoryProfiles, saveArtifactoryProfile,
  type ArtifactoryChild, type ArtifactoryItemInfo, type ArtifactoryProfile, type ArtifactoryRepository,
} from "../services/artifactoryService";
import "./artifactory.css";

function message(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试。"; }
function nameOf(child: ArtifactoryChild) {
  const raw = child.uri.replace(/^\//, "");
  try { return decodeURIComponent(raw); } catch { return raw; }
}
function sizeOf(value?: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

export function ArtifactoryWorkspace() {
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
  const [transfer, setTransfer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const repoRequestId = useRef(0);
  const folderRequestId = useRef(0);
  const detailRequestId = useRef(0);

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
    if (!window.confirm(`删除连接“${profile.name}”？仓库文件不会被删除。`)) return;
    try {
      await deleteArtifactoryProfile(profile.id);
      setProfiles((items) => items.filter((item) => item.id !== profile.id));
      if (active === profile.id) setActive(null);
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
      if (children.some((item) => nameOf(item) === fileName) && !window.confirm(`“${fileName}”已存在。继续上传将覆盖远端文件，是否继续？`)) continue;
      setTransfer(`上传 ${fileName}`);
      try { await artifactoryUpload(active, repo, `${path}${fileName}`, localPath); toast(`${fileName} 上传完成。`, "success"); }
      catch (reason) { toast(`${fileName}：${message(reason)}`, "error"); }
    }
    setTransfer(null); await refresh();
  }
  async function download() {
    if (!active || !repo || !selected || selected.folder) return;
    const filename = nameOf(selected);
    const destination = await save({ defaultPath: filename, title: "保存 Artifactory 文件" });
    if (!destination) return;
    setTransfer(`下载 ${filename}`);
    try { await artifactoryDownload(active, repo, `${path}${filename}`, destination); toast(`${filename} 下载完成。`, "success"); }
    catch (reason) {
      if (message(reason).includes("本地文件已存在") && window.confirm(`本地“${filename}”已存在。覆盖此文件？`)) {
        try { await artifactoryDownload(active, repo, `${path}${filename}`, destination, true); toast(`${filename} 下载完成。`, "success"); }
        catch (retryError) { toast(message(retryError), "error"); }
      } else { toast(message(reason), "error"); }
    }
    finally { setTransfer(null); }
  }

  return <section className="artifactory-workspace" aria-label="Artifactory 工作台">
    <aside className="artifactory-sidebar">
      <div className="artifactory-sidebar__head"><span><Icon name="database" />Artifactory</span><button aria-label="添加 Artifactory 连接" onClick={() => edit("new")} title="添加连接" type="button"><Icon name="plus" /></button></div>
      <div className="artifactory-sidebar__section">连接</div>
      {profiles.map((profile) => <div className={`artifactory-profile${active === profile.id ? " is-active" : ""}`} key={profile.id}>
        <button className="artifactory-profile__open" onClick={() => setActive(profile.id)} type="button"><Icon name="database" /><span>{profile.name}<small>{profile.baseUrl}</small></span></button>
        <button aria-label={`编辑 ${profile.name}`} onClick={() => edit(profile)} title="编辑" type="button"><Icon name="edit" /></button>
        <button aria-label={`删除 ${profile.name}`} onClick={() => void remove(profile)} title="删除" type="button"><Icon name="trash" /></button>
      </div>)}
      {!profiles.length && <p className="artifactory-sidebar__empty">暂无连接</p>}
      {active && <><div className="artifactory-sidebar__section">仓库 <span>{repos.length}</span></div>
        <input aria-label="筛选仓库" className="artifactory-input" onChange={(event) => setFilter(event.target.value)} placeholder="筛选仓库…" value={filter} />
        <div className="artifactory-repolist">{visibleRepos.map((item) => <button className={repo === item.key ? "is-active" : ""} key={item.key} onClick={() => enterRepo(item.key)} title={item.description || item.key} type="button"><Icon name="folder" /><span>{item.key}</span><small>{item.type}</small></button>)}</div>
      </>}
    </aside>
    <div className="artifactory-main">
      <header className="artifactory-toolbar"><div className="artifactory-heading"><strong>{currentRepo?.key ?? currentProfile?.name ?? "Artifactory"}</strong><span>{currentRepo ? `${currentRepo.type} · ${currentRepo.packageType}` : currentProfile?.baseUrl ?? "构件仓库浏览器"}</span></div>
        {repo && <div className="artifactory-actions"><button disabled={busy} onClick={() => void refresh()} title="刷新目录" type="button"><Icon name="refresh" /></button><button disabled={Boolean(transfer)} onClick={() => void upload()} type="button"><Icon name="upload" />上传文件</button><button disabled={!selected || selected.folder || Boolean(transfer)} onClick={() => void download()} type="button"><Icon name="download" />下载</button></div>}</header>
      {error && <div className="artifactory-error" role="alert">{error}<button onClick={() => { if (repo) void refresh(); else void retryRepositories(); }} type="button">重试</button></div>}
      {transfer && <div className="artifactory-transfer" role="status"><Icon name="refresh" />{transfer}…</div>}
      {!active ? <div className="artifactory-welcome"><div className="artifactory-welcome__icon"><Icon name="database" /></div><div className="artifactory-welcome__body"><span className="artifactory-welcome__eyebrow">开始使用</span><h2>添加 Artifactory 连接</h2><p>输入 JFrog Platform 地址和 Access Token，即可浏览仓库、查看文件属性并上传或下载构件。</p><button onClick={() => edit("new")} type="button"><Icon name="plus" />添加连接</button></div></div>
        : !repo ? <div className="artifactory-welcome"><div className="artifactory-welcome__icon"><Icon name="folder" /></div><div className="artifactory-welcome__body"><span className="artifactory-welcome__eyebrow">{currentProfile?.name}</span><h2>{busy ? "正在读取仓库" : "选择一个仓库"}</h2><p>{busy ? "仓库列表加载中…" : "在左侧选择仓库，浏览其中的目录和文件。"}</p></div></div>
        : <div className="artifactory-content"><div className="artifactory-browser"><nav aria-label="文件路径" className="artifactory-breadcrumb"><button onClick={() => setPath("")} type="button">{repo}</button>{path.split("/").filter(Boolean).map((part, index, all) => <span key={`${part}-${index}`}><Icon name="chevron-right" /><button onClick={() => setPath(`${all.slice(0, index + 1).join("/")}/`)} type="button">{part}</button></span>)}</nav>
          <div className="artifactory-listhead"><span>名称</span><span>类型</span></div>
          <div className="artifactory-list" role="listbox" aria-label="仓库文件">{path && <button className="artifactory-row" onClick={parent} type="button"><Icon name="arrowLeft" /><span>返回上一级</span></button>}{sortedChildren.map((child) => <button aria-selected={selected?.uri === child.uri} className={`artifactory-row${selected?.uri === child.uri ? " is-selected" : ""}`} key={child.uri} onClick={() => setSelected(child)} onDoubleClick={() => child.folder ? enterFolder(child) : void download()} role="option" type="button"><Icon name={child.folder ? "folder" : "file"} /><span>{nameOf(child)}</span><small>{child.folder ? "目录" : "文件"}</small></button>)}{!busy && !children.length && <p className="artifactory-muted">此目录为空。</p>}{busy && <p className="artifactory-muted">正在加载…</p>}</div>
        </div><aside className="artifactory-details"><h3>文件详情</h3>{selected ? <><div className="artifactory-details__name"><Icon name={selected.folder ? "folder" : "file"} />{nameOf(selected)}</div><dl><dt>路径</dt><dd>{repo}/{path}{nameOf(selected)}</dd><dt>大小</dt><dd>{selected.folder ? "—" : sizeOf(details?.size)}</dd><dt>类型</dt><dd>{details?.mimeType ?? (selected.folder ? "目录" : "—")}</dd><dt>创建时间</dt><dd>{details?.created ?? "—"}</dd><dt>修改时间</dt><dd>{details?.lastModified ?? "—"}</dd><dt>创建者</dt><dd>{details?.createdBy ?? "—"}</dd><dt>修改者</dt><dd>{details?.modifiedBy ?? "—"}</dd></dl><h4>校验和</h4>{Object.entries(details?.checksums ?? {}).map(([key, value]) => <div className="artifactory-property" key={key}><span>{key}</span><code title={value}>{value}</code></div>)}<h4>属性</h4>{Object.entries(details?.properties ?? {}).map(([key, value]) => <div className="artifactory-property" key={key}><span>{key}</span><code title={value.join(", ")}>{value.join(", ")}</code></div>)}{details?.propertiesError ? <p className="artifactory-muted">属性读取失败：{details.propertiesError}</p> : !Object.keys(details?.properties ?? {}).length && <p className="artifactory-muted">无自定义属性</p>}</> : <p className="artifactory-muted">选择文件或目录查看元数据。</p>}</aside></div>}
    </div>
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
  </section>;
}
