import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { TerminalSession } from "../models";
import type { JumpServerAccount, JumpServerAsset, JumpServerIdentity, JumpServerNode, JumpServerPage, JumpServerProfile } from "../models/jumpserver";
import { jumpServerIdentity, listJumpServerAccounts, listJumpServerAssets, listJumpServerNodes, logoutJumpServer, openJumpServerTerminal, openJumpServerSshGateway } from "../services/jumpserverService";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../rdp/useDialogFocus";
import { ConnectionViewToggle, type ConnectionViewMode } from "../ui/ConnectionViewToggle";
import { JumpServerLogin } from "./JumpServerLogin";
import { JumpServerAssetViews } from "./JumpServerAssetViews";
import "./jumpserver.css";

const VIEW_KEY = "dssh.jumpserver.view";
function loadAssetView(): ConnectionViewMode {
  try { const view = localStorage.getItem(VIEW_KEY); return view === "grid" || view === "tree" ? view : "list"; }
  catch { return "list"; }
}
const message = (e: unknown) => e instanceof Error ? e.message : "操作失败，请稍后重试。";

export function JumpServerWorkspace({ profile, loading = false, error, onBack, onCreate, onEdit, onDelete, onTerminal }: {
  profile: JumpServerProfile | null;
  loading?: boolean;
  error?: string | null;
  onBack: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTerminal: (session: TerminalSession) => Promise<void>;
}) {
  return <section className="jumpserver" aria-label="JumpServer 资产工作台">
    <header className="jumpserver__header">
      <Button variant="ghost" onClick={onBack}><Icon name="arrowLeft" width="16" height="16" />连接管理</Button>
      <div className="jumpserver__heading"><h1 title={profile?.name}>{profile?.name ?? "JumpServer"}</h1>
        {profile && <span>JumpServer</span>}
      </div>
    </header>
    {error && <p className="jumpserver__error" role="alert">{error}</p>}
    {loading ? <p className="jumpserver__empty" role="status">正在加载连接…</p> : profile ?
      <Platform key={profile.id} profile={profile} onTerminal={onTerminal} onEdit={onEdit} onDelete={onDelete} /> :
      <div className="jumpserver__empty"><Icon name="stackedHexagon" width="28" height="28" />
        <h2>尚未选择 JumpServer 连接</h2><p>从连接管理选择一个平台，或新建 JumpServer 连接后浏览授权资产。</p>
        <Button variant="primary" onClick={onCreate}>新建 JumpServer 连接</Button>
      </div>}
  </section>;
}

function Platform({ profile, onTerminal, onEdit, onDelete }: { profile: JumpServerProfile; onTerminal: (s: TerminalSession) => Promise<void>; onEdit: () => void; onDelete: () => void }) {
  const [identity, setIdentity] = useState<JumpServerIdentity | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [openingSsh, setOpeningSsh] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  useEffect(() => {
    let live = true;
    void jumpServerIdentity(profile.id).then((i) => { if (live) setIdentity(i); }).catch((e: unknown) => { if (live) setError(message(e)); }).finally(() => { if (live) setChecking(false); });
    const listener = listen<string>("jumpserver://logout", (e) => { if (live && e.payload === profile.id) setIdentity(null); });
    return () => { live = false; void listener.then((u) => u()); };
  }, [profile.id]);
  async function logout() {
    setLoggingOut(true); setError("");
    try { await logoutJumpServer(profile.id); setIdentity(null); setConfirmLogout(false); }
    catch (e) { setError(message(e)); }
    finally { setLoggingOut(false); }
  }
  async function openSsh() {
    if (openingSsh) return;
    setOpeningSsh(true); setError("");
    try { await onTerminal(await openJumpServerSshGateway(profile.id)); }
    catch (e) { setError(message(e)); }
    finally { setOpeningSsh(false); }
  }
  return <>
    <div className="jumpserver__platform"><span title={profile.coreUrl}>{profile.coreUrl}</span><span>{identity ? `${identity.username} · ` : ""}组织 {profile.orgId}</span>
      {identity ? <Button disabled={loggingOut} onClick={() => setConfirmLogout(true)}>退出登录</Button> : <><Button disabled={checking} onClick={onEdit}>编辑连接</Button><Button disabled={checking} onClick={onDelete}>删除连接</Button></>}
    </div>
    {error && <p className="jumpserver__error" role="alert">{error}</p>}
    {checking ? <p className="jumpserver__empty" role="status">正在读取登录状态…</p> : identity ? <AssetDirectory key={identity.generation} profile={profile} identity={identity} onTerminal={onTerminal} /> : <>
      <JumpServerLogin profile={profile} onReady={setIdentity} />
      {profile.sshProfileId && <div className="jumpserver__ssh-fallback"><Button disabled={openingSsh} onClick={() => void openSsh()}>{openingSsh ? "正在打开…" : "使用现有 SSH 连接"}</Button>
        <p className="profile-form__hint">沿用已关联的 SSH 配置和密码 / OTP 认证，打开原交互终端；此入口不加载资产目录。</p>
      </div>}
    </>}
    {confirmLogout && <Confirmation title="退出 JumpServer" busy={loggingOut} onCancel={() => setConfirmLogout(false)} onConfirm={() => void logout()}><p>退出“{profile.name}”并关闭所有窗口中属于资产工作台的终端？其中可能有正在运行的命令。保存的密码 / Access Key 不会被删除，单独打开的原 SSH 网关终端不受影响。</p></Confirmation>}
  </>;
}

function AssetDirectory({ profile, identity, onTerminal }: { profile: JumpServerProfile; identity: JumpServerIdentity; onTerminal: (s: TerminalSession) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [node, setNode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<JumpServerNode[]>([]);
  const [nodeOffset, setNodeOffset] = useState(0);
  const [moreNodes, setMoreNodes] = useState(false);
  const [nodeError, setNodeError] = useState("");
  const [page, setPage] = useState<JumpServerPage<JumpServerAsset> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JumpServerAsset | null>(null);
  const [revision, setRevision] = useState(0);
  const [autoConnect, setAutoConnect] = useState(0);
  const [view, setView] = useState<ConnectionViewMode>(loadAssetView);
  function changeView(next: ConnectionViewMode) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* Keep the current view when storage is unavailable. */ }
  }
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setOffset(0); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    let live = true;
    setNodeError("");
    void listJumpServerNodes(profile.id, identity.generation, nodeOffset).then((p) => { if (live) { setNodes((old) => nodeOffset ? [...old, ...p.results.filter((n) => !old.some((o) => o.id === n.id))] : p.results); setMoreNodes(p.hasMore); } }).catch((e: unknown) => { if (live) setNodeError(message(e)); });
    return () => { live = false; };
  }, [profile.id, identity.generation, nodeOffset, revision]);
  useEffect(() => {
    let live = true; setLoading(true); setSelected(null); setError("");
    void listJumpServerAssets(profile.id, identity.generation, search, offset, node).then((p) => { if (live) setPage(p); }).catch((e: unknown) => { if (live) setError(message(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [profile.id, identity.generation, search, offset, node, revision]);
  function selectNode(id: string | null) { setNode(id); setOffset(0); setSelected(null); }
  return <div className="jumpserver__directory" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); searchRef.current?.focus(); } }}>
    <div className="jumpserver__toolbar"><div className="jumpserver__search"><Icon name="search" width="16" height="16" /><input ref={searchRef} aria-label="搜索授权资产" placeholder="搜索服务器名称或地址" maxLength={256} spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button className="icon-button" type="button" aria-label="清除搜索" onClick={() => setQuery("")}><Icon name="close" width="14" height="14" /></button>}</div><Button disabled={loading} onClick={() => setRevision((r) => r + 1)}><Icon name="refresh" width="16" height="16" />刷新</Button><ConnectionViewToggle label="资产显示方式" value={view} onChange={changeView} /></div>
    <div className="jumpserver__body"><nav className="jumpserver__nodes" aria-label="授权资产目录"><button type="button" className={node === null ? "is-active" : ""} onClick={() => selectNode(null)}><Icon name="server" width="16" height="16" />全部授权资产</button>
      {[...nodes].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })).map((n) => <button type="button" key={n.id} className={node === n.id ? "is-active" : ""} title={n.name} onClick={() => selectNode(n.id)}><Icon name="folder" width="16" height="16" /><span>{n.name}</span></button>)}
      {moreNodes && <Button onClick={() => setNodeOffset((n) => n + 50)}>加载更多目录</Button>}{nodeError && <p role="alert">目录加载失败，可继续浏览全部资产。<Button onClick={() => setRevision((r) => r + 1)}>重试</Button></p>}
    </nav><div className="jumpserver__assets">
      {error && <p className="jumpserver__error" role="alert">{error}<Button onClick={() => setRevision((r) => r + 1)}>重试</Button></p>}
      <div className="jumpserver__asset-scroll" aria-busy={loading}>
        {loading ? <p className="jumpserver__empty" role="status">正在加载授权资产…</p> : !error && page?.results.length ?
          <JumpServerAssetViews assets={page.results} nodes={nodes} view={view} selectedId={selected?.id}
            onSelect={(asset) => { setSelected(asset); setAutoConnect(0); }}
            onConnect={(asset) => { setSelected(asset); setAutoConnect((n) => n + 1); }} /> :
          !error && <p className="jumpserver__empty">{search ? "没有匹配的授权资产。" : "当前目录没有授权资产。"}</p>}
      </div>
      <div className="jumpserver__pagination"><span>{loading ? "查询中" : `本页 ${page?.results.length ?? 0} 项${page?.count != null ? ` / 共 ${page.count} 项` : ""}`} · 当前用户授权范围</span><Button disabled={loading || offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 50))}>上一页</Button><Button disabled={loading || !!error || !page?.hasMore} onClick={() => setOffset((n) => n + 50)}>下一页</Button></div>
      {selected && !loading && !error ? <AccountPicker key={selected.id} profile={profile} identity={identity} asset={selected} autoConnect={autoConnect} onTerminal={onTerminal} /> : <p className="jumpserver__selection">选择服务器后查看授权账号。仅开放 SSH 终端；SFTP、主机工具和转发需单独适配。</p>}
    </div></div>
  </div>;
}

function AccountPicker({ profile, identity, asset, autoConnect, onTerminal }: { profile: JumpServerProfile; identity: JumpServerIdentity; asset: JumpServerAsset; autoConnect: number; onTerminal: (s: TerminalSession) => Promise<void> }) {
  const [accounts, setAccounts] = useState<JumpServerAccount[]>([]);
  const [alias, setAlias] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const autoHandled = useRef(-1);
  const selectRef = useRef<HTMLSelectElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; let live = true;
    void listJumpServerAccounts(profile.id, identity.generation, asset.id).then((list) => { if (live) { setAccounts(list); const valid = list.filter((a) => a.supported); setAlias(valid.length === 1 ? valid[0].alias : ""); } })
      .catch((e: unknown) => { if (live) setError(message(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; mounted.current = false; };
  }, [profile.id, identity.generation, asset.id]);
  async function connect(selectedAlias = alias) {
    if (busy || !selectedAlias) return;
    setBusy(true); setError("");
    try {
      const session = await openJumpServerTerminal({ profileId: profile.id, generation: identity.generation, assetId: asset.id, assetName: asset.name, accountAlias: selectedAlias, accountLabel: accounts.find((a) => a.alias === selectedAlias)?.username || selectedAlias });
      // The terminal exists now; always hand it to the workbench, including fast navigation.
      await onTerminal(session);
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (autoConnect <= 0) { autoHandled.current = -1; return; }
    if (loading || autoHandled.current === autoConnect) return;
    autoHandled.current = autoConnect;
    const valid = accounts.filter((a) => a.supported);
    if (valid.length === 1) void connect(valid[0].alias);
    else selectRef.current?.focus();
  });
  return <form className="jumpserver__account" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
    <strong title={asset.name}>{asset.name}</strong>
    {loading ? <span role="status">正在读取授权账号…</span> : <><label htmlFor="jumpserver-account">账号</label><select ref={selectRef} id="jumpserver-account" aria-label="资产授权账号" value={alias} disabled={busy} onChange={(e) => setAlias(e.target.value)}><option value="">请选择账号</option>{accounts.map((a) => <option key={a.alias} value={a.alias} disabled={!a.supported}>{a.name} · {a.username}{!a.supported ? "（需官方 Web）" : ""}</option>)}</select><Button variant="primary" type="submit" disabled={busy || !alias}>{busy ? "正在打开…" : "连接终端"}</Button>{accounts.length === 0 && !error && <span>无授权账号</span>}</>}
    {error && <p className="jumpserver__error" role="alert">{error}</p>}
  </form>;
}

function Confirmation({ title, busy, children, onCancel, onConfirm }: { title: string; busy: boolean; children: React.ReactNode; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialogFocus();
  return <div className="profile-editor-backdrop" role="presentation"><section ref={ref} className="profile-editor is-glass-overlay jumpserver__confirm" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel(); }}><h2>{title}</h2>{children}<footer><Button autoFocus disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy} onClick={onConfirm}>{busy ? "正在处理…" : "确认"}</Button></footer></section></div>;
}
