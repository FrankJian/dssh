import { isWindows } from "../platform";
import type { ConnectionGroupRequest } from "../app/connectionPalette";
import { RenameFolderDialog } from "./RenameFolderDialog";
import { ConnectionFolderTree } from "./ConnectionFolderTree";
import type { SshProfile } from "../models";
import { buildConnectionFolders, isInConnectionFolder, renamedConnectionFolderPath } from "./connectionFolders";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { ConnectionCard } from "./ConnectionCard";
import { RenameTagDialog } from "./RenameTagDialog";
import {
  CONNECTION_TYPE_OPTIONS,
  connectionTypeForProfile,
  connectionTypeLabel,
  isRdpProfile,
  isJumpServerProfile,
  isSmbProfile,
  type ConnectionType,
  type ConnectionProfile,
} from "./connectionTypes";

import { ConnectionViewToggle, type ConnectionViewMode as ViewMode } from "../ui/ConnectionViewToggle";
type Scope = "all" | "recent" | "untagged" | `folder:${string}` | `tag:${string}` | `type:${ConnectionType}`;
type SortKey = "name" | "host";

const VIEW_KEY = "dssh.sessionManager.view";
const SORT_KEY = "dssh.sessionManager.sort";
const TYPE_FILTER_KEY = "dssh.sessionManager.typeFilter";

type ConnectionTypeFilter = "all" | ConnectionType;

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "host", label: "主机" },
];

const TYPE_FILTER_OPTIONS: { id: ConnectionTypeFilter; label: string }[] = [
  { id: "all", label: "全部类型" },
  ...CONNECTION_TYPE_OPTIONS.map((option) => ({ id: option.id, label: option.label })),
];

function loadView(): ViewMode {
  const raw = localStorage.getItem(VIEW_KEY);
  return raw === "grid" || raw === "list" || raw === "tree" ? raw : "list";
}

function loadSort(): SortKey {
  const raw = localStorage.getItem(SORT_KEY);
  return raw === "host" ? "host" : "name";
}

function loadTypeFilter(): ConnectionTypeFilter {
  const raw = localStorage.getItem(TYPE_FILTER_KEY);
  return raw === "ssh" || raw === "telnet" || raw === "sftp" || raw === "rdp" || raw === "jumpserver" || raw === "smb" ? raw : "all";
}

interface SessionManagerProps {
  groupRequest?: ConnectionGroupRequest | null;
  onGroupRequestHandled?: (requestId: number) => void;
  profiles: ConnectionProfile[];
  recentIds: string[];
  recentLimit: number;
  activeSessionCount: number;
  isLoading: boolean;
  errorMessage: string | null;
  onConnect: (profile: ConnectionProfile) => void;
  onOpenSftp: (profile: SshProfile) => void;
  onCreate: (initialTags?: string[], initialFolder?: string) => void;
  onCreateSftp: (initialTags?: string[], initialFolder?: string) => void;
  onCreateRdp: (initialTags?: string[], initialFolder?: string) => void;
  onCreateSmb: (initialTags?: string[], initialFolder?: string) => void;
  onDisconnectSmb: (profile: ConnectionProfile) => void;
  onCreateJumpServer: (initialFolder?: string) => void;
  onEdit: (profile: ConnectionProfile) => void;
  onClone: (profile: ConnectionProfile) => void;
  onDelete: (profile: ConnectionProfile) => void;
  onRenameFolder: (oldPath: string, newName: string) => Promise<void>;
  onRenameTag: (oldTag: string, newTag: string) => Promise<void>;
}

export function SessionManager({
  groupRequest,
  onGroupRequestHandled,
  profiles,
  recentIds,
  recentLimit,
  activeSessionCount,
  isLoading,
  errorMessage,
  onConnect,
  onOpenSftp,
  onCreate,
  onCreateSftp,
  onCreateRdp,
  onCreateSmb,
  onDisconnectSmb,
  onCreateJumpServer,
  onEdit,
  onClone,
  onDelete,
  onRenameTag,
  onRenameFolder,
}: SessionManagerProps) {
  const [tagMenu, setTagMenu] = useState<{ tag: string; kind?: "folder"; x: number; y: number } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tagTriggerRef = useRef<HTMLButtonElement | null>(null);
  const navRef = useRef<HTMLElement>(null);

  function restoreTagFocus() {
    if (tagTriggerRef.current?.isConnected) tagTriggerRef.current.focus();
    else (navRef.current?.querySelector<HTMLButtonElement>("button[aria-current]")
      ?? navRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }

  useEffect(() => {
    if (!tagMenu) return;
    function closeOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setTagMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setTagMenu(null);
        restoreTagFocus();
      }
    }
    function closeOnResize() { setTagMenu(null); }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [tagMenu]);
  const [scope, setScope] = useState<Scope>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>(() => loadView());
  const [sort, setSort] = useState<SortKey>(() => loadSort());
  const [typeFilter, setTypeFilter] = useState<ConnectionTypeFilter>(() => loadTypeFilter());

  useEffect(() => {
    if (!groupRequest) return;
    setScope(groupRequest.scope);
    setQuery("");
    setTypeFilter("all");
    localStorage.setItem(TYPE_FILTER_KEY, "all");
    onGroupRequestHandled?.(groupRequest.requestId);
  }, [groupRequest, onGroupRequestHandled]);

  function changeView(next: ViewMode) {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  function changeSort(next: SortKey) {
    setSort(next);
    localStorage.setItem(SORT_KEY, next);
  }

  function changeTypeFilter(next: ConnectionTypeFilter) {
    if (scope.startsWith("type:")) setScope("all");
    setTypeFilter(next);
    localStorage.setItem(TYPE_FILTER_KEY, next);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const tags = useMemo(() => Array.from(new Set(profiles.flatMap((profile) => profile.tags)))
    .sort((a, b) => a.localeCompare(b)), [profiles]);
  const folders = useMemo(() => profiles.length > 0 ? [{
    name: "根目录", path: "", count: profiles.length, children: buildConnectionFolders(profiles),
  }] : [], [profiles]);
  const recentSet = useMemo(() => new Set(recentIds.filter((id) => profiles.some((profile) => profile.id === id)).slice(0, recentLimit)), [profiles, recentIds, recentLimit]);
  const untaggedCount = profiles.filter((profile) => profile.tags.length === 0).length;
  const typeCategories = CONNECTION_TYPE_OPTIONS.map((option) => ({ ...option,
    count: profiles.filter((profile) => connectionTypeForProfile(profile) === option.id).length,
  })).filter((option) => option.count > 0);
  // Return to all connections when a category becomes empty and disappears.
  const scopeIsEmpty = (scope.startsWith("folder:") && !profiles.some((profile) => isInConnectionFolder(profile, scope.slice(7))))
    || (scope.startsWith("tag:") && !tags.includes(scope.slice(4)))
    || (scope.startsWith("type:") && !typeCategories.some((option) => `type:${option.id}` === scope))
    || (scope === "recent" && recentSet.size === 0)
    || (scope === "untagged" && untaggedCount === 0);
  const activeScope = scopeIsEmpty ? "all" : scope;
  const activeTypeFilter: ConnectionTypeFilter = activeScope.startsWith("type:")
    ? activeScope.slice(5) as ConnectionType : typeFilter;
  const scopeLabel = activeScope.startsWith("folder:") ? (activeScope.slice(7) || "根目录") : activeScope === "recent" ? "最近使用"
    : activeScope === "untagged" ? "未分组" : activeScope.startsWith("tag:") ? activeScope.slice(4)
    : activeScope.startsWith("type:") ? connectionTypeLabel(activeTypeFilter as ConnectionType) : "全部连接";

  const filtered = useMemo(() => {
    return profiles.filter((profile) => {
      if (activeScope.startsWith("folder:") && !isInConnectionFolder(profile, activeScope.slice(7))) return false;
      if (activeScope === "recent" && !recentSet.has(profile.id)) return false;
      if (activeScope === "untagged" && profile.tags.length > 0) return false;
      if (activeScope.startsWith("tag:") && !profile.tags.includes(activeScope.slice(4))) return false;
      if (activeTypeFilter !== "all" && connectionTypeForProfile(profile) !== activeTypeFilter) {
        return false;
      }
      if (!isSearching) {
        return true;
      }
      const haystack =
        `${profile.name} ${isSmbProfile(profile) ? profile.sharePath : ""} ${profile.username}@${profile.host}:${profile.port} ${profile.tags.join(" ")} ${profile.folder ?? ""} ${profile.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [profiles, normalizedQuery, isSearching, activeTypeFilter, activeScope, recentSet]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const byName = (a: ConnectionProfile, b: ConnectionProfile) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id);
    if (activeScope === "recent") {
      const rank = new Map(recentIds.map((id, index) => [id, index]));
      list.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER)
        - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || byName(a, b));
    } else if (sort === "host") {
      list.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }) || byName(a, b));
    } else {
      list.sort(byName);
    }
    return list;
  }, [filtered, sort, recentIds, activeScope]);

  const tagGroups = useMemo(() => {
    const groups = tags.map((tag) => ({ key: `tag:${tag}`, label: tag,
      profiles: sorted.filter((profile) => profile.tags.includes(tag)) }));
    groups.push({ key: "untagged", label: "未分组", profiles: sorted.filter((profile) => profile.tags.length === 0) });
    return groups.filter((group) => group.profiles.length > 0);
  }, [sorted, tags]);

  const cardVariant = view === "grid" ? "grid" : "list";

  function renderScope(id: Scope, label: string, icon: IconName, count: number) {
    if (count === 0) return null;
    return <button key={id} type="button" className={`session-manager__nav-item${activeScope === id ? " is-active" : ""}`}
      aria-haspopup={id.startsWith("tag:") ? "menu" : undefined}
      onContextMenu={(event) => {
        if (!id.startsWith("tag:")) return;
        event.preventDefault();
        tagTriggerRef.current = event.currentTarget;
        setTagMenu({ tag: label, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - 56)) });
      }}
      onKeyDown={(event) => {
        if (!id.startsWith("tag:") || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        tagTriggerRef.current = event.currentTarget;
        setTagMenu({ tag: label, x: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
          y: Math.max(8, Math.min(rect.bottom, window.innerHeight - 56)) });
      }}
      aria-current={activeScope === id ? "page" : undefined} onClick={() => {
        if (id.startsWith("type:") || scope.startsWith("type:")) changeTypeFilter("all");
        setScope(id);
      }} title={label}>
      <Icon name={icon} height="16" width="16" />
      <span className="session-manager__nav-label">{label}</span><span className="session-manager__nav-count">{count}</span>
    </button>;
  }

  function resetFilters() {
    setQuery("");
    changeTypeFilter("all");
    setScope("all");
  }

  function createConnection() {
    const folder = activeScope.startsWith("folder:") ? activeScope.slice(7) : "";
    if (activeTypeFilter === "jumpserver") { onCreateJumpServer(folder); return; }
    (activeTypeFilter === "rdp" ? onCreateRdp : activeTypeFilter === "smb" ? onCreateSmb : activeTypeFilter === "sftp" ? onCreateSftp : onCreate)(activeScope.startsWith("tag:") ? [activeScope.slice(4)] : [], folder);
  }

  function renderCards(list: ConnectionProfile[]) {
    return (
      <div className={`session-manager__cards ${cardVariant === "list" ? "is-list" : "is-grid"}`}>
        {list.map((profile) => (
          <ConnectionCard
            key={profile.id}
            profile={profile}
            variant={cardVariant}
            onConnect={() => onConnect(profile)}
            onOpenSftp={!isRdpProfile(profile) && !isJumpServerProfile(profile) && !isSmbProfile(profile) ? () => onOpenSftp(profile) : undefined}
            onDisconnect={isWindows && isSmbProfile(profile) ? () => onDisconnectSmb(profile) : undefined}
            onEdit={() => onEdit(profile)}
            onClone={() => onClone(profile)}
            onDelete={() => onDelete(profile)}
          />
        ))}
        {cardVariant === "grid" ? (
          <button className="session-manager__create-tile" onClick={createConnection} type="button">
            <Icon name="plus" height="24" width="24" />
            <span>新建连接</span>
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="session-manager" aria-label="会话管理器">
      <header className="session-manager__header">
        <div className="session-manager__heading"><Icon name="connections" height="18" width="18" />
          <h1>连接管理</h1><span>{profiles.length} 个连接</span></div>
        <button className="session-manager__new" onClick={createConnection} type="button" aria-label="新建连接">
          <Icon name="plus" height="15" width="15" /><span>新建连接</span>
        </button>
      </header>
      <div className="session-manager__body">
        {profiles.length > 0 ? <nav className="session-manager__nav" aria-label="连接分类" ref={navRef}>
          <div className="session-manager__nav-title">连接库</div>
          {renderScope("all", "全部连接", "connections", profiles.length)}
          {renderScope("recent", "最近使用", "clock", recentSet.size)}
          {typeCategories.map((option) => renderScope(`type:${option.id}`, option.label, option.icon, option.count))}
          <div className="session-manager__nav-separator" role="separator" />
          <div className="session-manager__folder-nav">
            <div className="session-manager__nav-title">目录分组</div>
            <ConnectionFolderTree nodes={folders} selectedPath={activeScope.startsWith("folder:") ? activeScope.slice(7) : null}
              onContextMenu={(path, x, y, trigger) => {
                tagTriggerRef.current = trigger;
                setTagMenu({ tag: path, kind: "folder", x: Math.max(8, Math.min(x, window.innerWidth - 228)),
                  y: Math.max(8, Math.min(y, window.innerHeight - 56)) });
              }}
              onSelect={(path) => { if (scope.startsWith("type:")) changeTypeFilter("all"); setScope(`folder:${path}`); }} />
          </div>
          <div className="session-manager__nav-separator" role="separator" />
          <div className="session-manager__nav-title" title="按连接标签自动分组；一个连接可以属于多个分组">标签分组</div>
          {tags.map((tag) => renderScope(`tag:${tag}`, tag, "tag", profiles.filter((profile) => profile.tags.includes(tag)).length))}
          {renderScope("untagged", "未分组", "tag", untaggedCount)}
        </nav> : null}
        <div className="session-manager__main">
          <div className="session-manager__toolbar">
            <div className="session-manager__search">
              <Icon name="search" height="15" width="15" />
              <input aria-label="搜索连接" placeholder="搜索名称、主机、用户、目录或标签" value={query}
                onChange={(event) => setQuery(event.target.value)} spellCheck={false} />
              {query ? <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}><Icon name="close" height="14" width="14" /></button> : null}
            </div>
            <div className="session-manager__sort">
              <span>排序</span>
              <SelectMenu
                ariaLabel="连接排序"
                onChange={(value) => changeSort(value as SortKey)}
                disabled={activeScope === "recent"}
                options={activeScope === "recent" ? [{ label: "最近使用", value: "recent" }]
                  : SORT_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
                value={activeScope === "recent" ? "recent" : sort}
              />
            </div>
            <ConnectionViewToggle value={view} onChange={changeView} />
            <div className="session-manager__group">
              <span>类型</span>
              <SelectMenu
                ariaLabel="连接类型筛选"
                onChange={(value) => changeTypeFilter(value as ConnectionTypeFilter)}
                options={TYPE_FILTER_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
                value={activeTypeFilter}
              />
            </div>
          </div>

          <div className="session-manager__content">
            {errorMessage ? <div className="sidebar__error">{errorMessage}</div> : null}
            {isLoading ? (
              <div className="session-manager__empty">正在加载连接...</div>
            ) : profiles.length === 0 ? (
              <div className="session-manager__empty">
                <Icon name="connections" height="28" width="28" />
                <p className="session-manager__empty-title">还没有保存的连接</p>
              </div>
            ) : (
              <>
                <div className="session-manager__results-head">
                  <h2>{scopeLabel}</h2><span aria-live="polite">{sorted.length} 个连接{activeScope.startsWith("folder:") ? " · 含子目录" : ""}{isSearching ? " · 搜索结果" : ""}</span>
                </div>
                {sorted.length === 0 ? (
                  <div className="session-manager__empty">
                    <Icon name="search" height="24" width="24" />
                    <p className="session-manager__empty-title">没有匹配的连接</p>
                    <button type="button" className="session-manager__reset" onClick={resetFilters}>显示全部连接</button>
                  </div>
                ) : view === "tree" && !activeScope.startsWith("folder:") ? tagGroups.map((group) => (
                  <section className="session-manager__section" key={group.key}>
                    <button className="session-manager__section-head" type="button"
                      aria-expanded={!collapsedGroups.has(group.key)}
                      onClick={() => setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                        return next;
                      })}>
                      <Icon name={collapsedGroups.has(group.key) ? "chevron-right" : "chevron-down"} height="14" width="14" />
                      <Icon name="tag" height="15" width="15" />
                      <span>{group.label}</span><span className="session-manager__section-count">{group.profiles.length}</span>
                    </button>
                    {!collapsedGroups.has(group.key) ? renderCards(group.profiles) : null}
                  </section>
                )) : renderCards(sorted)}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="session-manager__status">
        <span>{profiles.length} 个连接</span>
        <span className="session-manager__status-dot" />
        <span>{activeSessionCount} 个活动会话</span>
      </div>
      {tagMenu ? createPortal(
        <div className="context-menu is-glass-overlay" role="menu" aria-label={tagMenu.kind === "folder" ? "目录操作" : "标签分组操作"} ref={menuRef}
          style={{ left: tagMenu.x, top: tagMenu.y }} onContextMenu={(event) => event.preventDefault()}>
          <button className="context-menu__item" role="menuitem" type="button" autoFocus
            onKeyDown={(event) => {
              if (event.key === "Tab") { event.preventDefault(); setTagMenu(null); restoreTagFocus(); }
            }}
            onClick={() => { if (tagMenu.kind === "folder") setRenamingFolder(tagMenu.tag); else setRenamingTag(tagMenu.tag); setTagMenu(null); }}>
            <Icon name="edit" height="16" width="16" /><span>{tagMenu.kind === "folder" ? "重命名目录" : "重命名标签"}</span>
          </button>
        </div>, document.body,
      ) : null}
      {renamingFolder !== null ? createPortal(
        <RenameFolderDialog path={renamingFolder}
          count={profiles.filter((profile) => isInConnectionFolder(profile, renamingFolder)).length}
          onClose={() => { setRenamingFolder(null); restoreTagFocus(); }}
          onRename={async (name) => {
            const next = renamedConnectionFolderPath(renamingFolder, name);
            await onRenameFolder(renamingFolder, name);
            if (scope.startsWith("folder:") && isInConnectionFolder({ folder: scope.slice(7) }, renamingFolder)) {
              setScope(`folder:${next}${scope.slice(7 + renamingFolder.length)}`);
            }
          }} />,
        document.body,
      ) : null}
      {renamingTag !== null ? createPortal(
        <RenameTagDialog tag={renamingTag} allTags={tags}
          count={profiles.filter((profile) => profile.tags.includes(renamingTag)).length}
          onClose={() => { setRenamingTag(null); restoreTagFocus(); }}
          onRename={async (name) => {
            await onRenameTag(renamingTag, name);
            if (scope === `tag:${renamingTag}`) setScope(`tag:${name}`);
          }} />,
        document.body,
      ) : null}
    </section>
  );
}
