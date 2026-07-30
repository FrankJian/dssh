import { useMemo, useState } from "react";
import type { SshProfile } from "../models";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { ConnectionCard } from "./ConnectionCard";
import {
  CONNECTION_TYPE_OPTIONS,
  connectionTypeForProfile,
  type ConnectionType,
} from "./connectionTypes";
import { groupProfiles } from "./profileGroups";

type ViewMode = "grid" | "list" | "tree";
type SortKey = "recent" | "name" | "host";

const VIEW_KEY = "dssh.sessionManager.view";
const SORT_KEY = "dssh.sessionManager.sort";
const TYPE_FILTER_KEY = "dssh.sessionManager.typeFilter";
const RECENT_SECTION_MAX = 6;

type ConnectionTypeFilter = "all" | ConnectionType;

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: "connections" | "monitor" | "sessions" }[] = [
  { id: "grid", label: "网格", icon: "monitor" },
  { id: "list", label: "列表", icon: "connections" },
  { id: "tree", label: "分组", icon: "sessions" },
];

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
  return raw === "grid" || raw === "list" || raw === "tree" ? raw : "grid";
}

function loadSort(): SortKey {
  const raw = localStorage.getItem(SORT_KEY);
  return raw === "recent" || raw === "name" || raw === "host" ? raw : "recent";
}

function loadTypeFilter(): ConnectionTypeFilter {
  const raw = localStorage.getItem(TYPE_FILTER_KEY);
  return raw === "ssh" || raw === "telnet" || raw === "sftp" ? raw : "all";
}

interface SessionManagerProps {
  profiles: SshProfile[];
  recentIds: string[];
  activeSessionCount: number;
  isLoading: boolean;
  errorMessage: string | null;
  onConnect: (profile: SshProfile) => void;
  onCreate: () => void;
  onEdit: (profile: SshProfile) => void;
  onDelete: (profileId: string) => void;
  onToggleFavorite: (profileId: string) => void;
}

export function SessionManager({
  profiles,
  recentIds,
  activeSessionCount,
  isLoading,
  errorMessage,
  onConnect,
  onCreate,
  onEdit,
  onDelete,
  onToggleFavorite,
}: SessionManagerProps) {
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
    setTypeFilter(next);
    localStorage.setItem(TYPE_FILTER_KEY, next);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const filtered = useMemo(() => {
    return profiles.filter((profile) => {
      if (typeFilter !== "all" && connectionTypeForProfile(profile) !== typeFilter) {
        return false;
      }
      if (!isSearching) {
        return true;
      }
      const haystack =
        `${profile.name} ${profile.username}@${profile.host}:${profile.port} ${profile.tags.join(" ")} ${profile.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [profiles, normalizedQuery, isSearching, typeFilter]);

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

  const recentProfiles = useMemo(() => {
    if (isSearching) {
      return [];
    }
    return recentIds
      .map((id) => profiles.find((profile) => profile.id === id))
      .filter((profile): profile is SshProfile => {
        if (!profile) {
          return false;
        }
        return typeFilter === "all" || connectionTypeForProfile(profile) === typeFilter;
      })
      .slice(0, RECENT_SECTION_MAX);
  }, [recentIds, profiles, isSearching, typeFilter]);

  const tagGroups = useMemo(() => groupProfiles(sorted), [sorted]);

  const cardVariant = view === "list" ? "list" : "grid";

  function renderCards(list: SshProfile[]) {
    return (
      <div className={`session-manager__cards ${view === "list" ? "is-list" : "is-grid"}`}>
        {list.map((profile) => (
          <ConnectionCard
            key={profile.id}
            profile={profile}
            variant={cardVariant}
            onConnect={() => onConnect(profile)}
            onEdit={() => onEdit(profile)}
            onDelete={() => onDelete(profile.id)}
            onToggleFavorite={() => onToggleFavorite(profile.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="session-manager" aria-label="会话管理器">
      <div className="session-manager__toolbar">
        <div className="session-manager__search">
          <Icon name="search" height="15" width="15" />
          <input
            aria-label="搜索连接"
            placeholder="搜索名称、主机、用户或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
        </div>
        <button className="session-manager__new" onClick={onCreate} type="button">
          <Icon name="plus" height="15" width="15" />
          <span>新建连接</span>
        </button>
        <div className="session-manager__sort">
          <span>排序</span>
          <SelectMenu
            ariaLabel="连接排序"
            onChange={(value) => changeSort(value as SortKey)}
            options={SORT_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
            value={sort}
          />
        </div>
        <div className="session-manager__views" role="tablist" aria-label="视图">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`session-manager__view ${view === option.id ? "is-active" : ""}`.trim()}
              onClick={() => changeView(option.id)}
              title={option.label}
              aria-label={option.label}
              aria-selected={view === option.id}
              role="tab"
              type="button"
            >
              <Icon name={option.icon} height="15" width="15" />
            </button>
          ))}
        </div>
        <div className="session-manager__group">
          <span>类型</span>
          <SelectMenu
            ariaLabel="连接类型筛选"
            onChange={(value) => changeTypeFilter(value as ConnectionTypeFilter)}
            options={TYPE_FILTER_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
            value={typeFilter}
          />
        </div>
        <div className="session-manager__toolbar-spacer" />
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
            {recentProfiles.length > 0 ? (
              <section className="session-manager__section">
                <div className="session-manager__section-head">最近使用</div>
                {renderCards(recentProfiles)}
              </section>
            ) : null}

            {view === "tree" ? (
              tagGroups.length > 0 ? (
                tagGroups.map((group) => (
                  <section className="session-manager__section" key={group.key}>
                    <div className="session-manager__section-head">
                      {group.label}
                      <span className="session-manager__section-count">{group.profiles.length}</span>
                    </div>
                    {renderCards(group.profiles)}
                  </section>
                ))
              ) : (
                <div className="session-manager__empty">没有匹配的连接。</div>
              )
            ) : (
              <section className="session-manager__section">
                <div className="session-manager__section-head">
                  {isSearching ? "搜索结果" : "全部连接"}
                  <span className="session-manager__section-count">{sorted.length}</span>
                </div>
                {sorted.length > 0 ? (
                  renderCards(sorted)
                ) : (
                  <div className="session-manager__empty">没有匹配的连接。</div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <div className="session-manager__status">
        <span>{profiles.length} 个连接</span>
        <span className="session-manager__status-dot" />
        <span>{activeSessionCount} 个活动会话</span>
      </div>
    </section>
  );
}
