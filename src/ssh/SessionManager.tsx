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
  type ConnectionType,
  type ConnectionProfile,
} from "./connectionTypes";

import { ConnectionViewToggle, type ConnectionViewMode as ViewMode } from "../ui/ConnectionViewToggle";
type Scope = "all" | "favorites" | "recent" | "untagged" | `tag:${string}` | `type:${ConnectionType}`;
type SortKey = "recent" | "name" | "host";

const VIEW_KEY = "dssh.sessionManager.view";
const SORT_KEY = "dssh.sessionManager.sort";
const TYPE_FILTER_KEY = "dssh.sessionManager.typeFilter";

type ConnectionTypeFilter = "all" | ConnectionType;

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "最近使用" },
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
  return raw === "recent" || raw === "name" || raw === "host" ? raw : "recent";
}

function loadTypeFilter(): ConnectionTypeFilter {
  const raw = localStorage.getItem(TYPE_FILTER_KEY);
  return raw === "ssh" || raw === "telnet" || raw === "sftp" || raw === "rdp" || raw === "jumpserver" ? raw : "all";
}

interface SessionManagerProps {
  profiles: ConnectionProfile[];
  recentIds: string[];
  recentLimit: number;
  activeSessionCount: number;
  isLoading: boolean;
  errorMessage: string | null;
  onConnect: (profile: ConnectionProfile) => void;
  onCreate: (initialTags?: string[]) => void;
  onCreateRdp: (initialTags?: string[]) => void;
  onCreateJumpServer: () => void;
  onEdit: (profile: ConnectionProfile) => void;
  onClone: (profile: ConnectionProfile) => void;
  onDelete: (profile: ConnectionProfile) => void;
  onToggleFavorite: (profile: ConnectionProfile) => void;
  onRenameTag: (oldTag: string, newTag: string) => Promise<void>;
}

export function SessionManager({
  profiles,
  recentIds,
  recentLimit,
  activeSessionCount,
  isLoading,
  errorMessage,
  onConnect,
  onCreate,
  onCreateRdp,
  onCreateJumpServer,
  onEdit,
  onClone,
  onDelete,
  onToggleFavorite,
  onRenameTag,
}: SessionManagerProps) {
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
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
  const recentSet = useMemo(() => new Set(recentIds.filter((id) => profiles.some((profile) => profile.id === id)).slice(0, recentLimit)), [profiles, recentIds, recentLimit]);
  const favoriteCount = profiles.filter((profile) => profile.favorite).length;
  const untaggedCount = profiles.filter((profile) => profile.tags.length === 0).length;
  const typeCategories = CONNECTION_TYPE_OPTIONS.map((option) => ({ ...option,
    count: profiles.filter((profile) => connectionTypeForProfile(profile) === option.id).length,
  })).filter((option) => option.count > 0);
  // Return to all connections when a category becomes empty and disappears.
  const scopeIsEmpty = (scope.startsWith("tag:") && !tags.includes(scope.slice(4)))
    || (scope.startsWith("type:") && !typeCategories.some((option) => `type:${option.id}` === scope))
    || (scope === "favorites" && favoriteCount === 0)
    || (scope === "recent" && recentSet.size === 0)
    || (scope === "untagged" && untaggedCount === 0);
  const activeScope = scopeIsEmpty ? "all" : scope;
  const activeTypeFilter: ConnectionTypeFilter = activeScope.startsWith("type:")
    ? activeScope.slice(5) as ConnectionType : typeFilter;
  const scopeLabel = activeScope === "favorites" ? "收藏" : activeScope === "recent" ? "最近使用"
    : activeScope === "untagged" ? "未分组" : activeScope.startsWith("tag:") ? activeScope.slice(4)
    : activeScope.startsWith("type:") ? connectionTypeLabel(activeTypeFilter as ConnectionType) : "全部连接";

  const filtered = useMemo(() => {
    return profiles.filter((profile) => {
      if (activeScope === "favorites" && !profile.favorite) return false;
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
        `${profile.name} ${profile.username}@${profile.host}:${profile.port} ${profile.tags.join(" ")} ${profile.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [profiles, normalizedQuery, isSearching, activeTypeFilter, activeScope, recentSet]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "host") {
      list.sort((a, b) => a.host.localeCompare(b.host) || a.name.localeCompare(b.name));
    } else {
      const rank = new Map(recentIds.map((id, index) => [id, index]));
      list.sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
        return ra - rb || a.name.localeCompare(b.name);
      });
    }
    return list;
  }, [filtered, sort, recentIds]);

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
    if (activeTypeFilter === "jumpserver") { onCreateJumpServer(); return; }
    (activeTypeFilter === "rdp" ? onCreateRdp : onCreate)(activeScope.startsWith("tag:") ? [activeScope.slice(4)] : []);
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
            onEdit={() => onEdit(profile)}
            onClone={() => onClone(profile)}
            onDelete={() => onDelete(profile)}
            onToggleFavorite={() => onToggleFavorite(profile)}
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
          {renderScope("favorites", "收藏", "star", favoriteCount)}
          {renderScope("recent", "最近使用", "clock", recentSet.size)}
          {typeCategories.map((option) => renderScope(`type:${option.id}`, option.label, option.icon, option.count))}
          <div className="session-manager__nav-title" title="按连接标签自动分组；一个连接可以属于多个分组">标签分组</div>
          {tags.map((tag) => renderScope(`tag:${tag}`, tag, "folder", profiles.filter((profile) => profile.tags.includes(tag)).length))}
          {renderScope("untagged", "未分组", "folder", untaggedCount)}
        </nav> : null}
        <div className="session-manager__main">
          <div className="session-manager__toolbar">
            <div className="session-manager__search">
              <Icon name="search" height="15" width="15" />
              <input aria-label="搜索连接" placeholder="搜索名称、主机、用户或标签" value={query}
                onChange={(event) => setQuery(event.target.value)} spellCheck={false} />
              {query ? <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}><Icon name="close" height="14" width="14" /></button> : null}
            </div>
            <div className="session-manager__sort">
              <span>排序</span>
              <SelectMenu
                ariaLabel="连接排序"
                onChange={(value) => changeSort(value as SortKey)}
                options={SORT_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
                value={sort}
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
                <p className="session-manager__empty-hint">点击「新建连接」添加你的第一台服务器。</p>
              </div>
            ) : (
              <>
                <div className="session-manager__results-head">
                  <h2>{scopeLabel}</h2><span aria-live="polite">{sorted.length} 个连接{isSearching ? " · 搜索结果" : ""}</span>
                  {view === "tree" ? <span className="session-manager__group-hint">按标签分组</span> : null}
                </div>
                {sorted.length === 0 ? (
                  <div className="session-manager__empty">
                    <Icon name="search" height="24" width="24" />
                    <p className="session-manager__empty-title">没有匹配的连接</p>
                    <p className="session-manager__empty-hint">试试其他关键词、类型或分组。</p>
                    <button type="button" className="session-manager__reset" onClick={resetFilters}>显示全部连接</button>
                  </div>
                ) : view === "tree" ? tagGroups.map((group) => (
                  <section className="session-manager__section" key={group.key}>
                    <button className="session-manager__section-head" type="button"
                      aria-expanded={!collapsedGroups.has(group.key)}
                      onClick={() => setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                        return next;
                      })}>
                      <Icon name={collapsedGroups.has(group.key) ? "chevron-right" : "chevron-down"} height="14" width="14" />
                      <Icon name="folder" height="15" width="15" />
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
        <div className="context-menu is-glass-overlay" role="menu" aria-label="标签分组操作" ref={menuRef}
          style={{ left: tagMenu.x, top: tagMenu.y }} onContextMenu={(event) => event.preventDefault()}>
          <button className="context-menu__item" role="menuitem" type="button" autoFocus
            onKeyDown={(event) => {
              if (event.key === "Tab") { event.preventDefault(); setTagMenu(null); restoreTagFocus(); }
            }}
            onClick={() => { setRenamingTag(tagMenu.tag); setTagMenu(null); }}>
            <Icon name="edit" height="16" width="16" /><span>重命名标签</span>
          </button>
        </div>, document.body,
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
