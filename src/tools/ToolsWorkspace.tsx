import { Suspense, useEffect, useId, useRef, useState } from "react";
import { ToolAction } from "./ToolControls";
import { IconButton } from "../ui/IconButton";
import { Icon, type IconName } from "../ui/Icon";
import { SegmentedControl } from "../ui/SegmentedControl";
import { WorkspaceToolbar } from "../ui/WorkspaceToolbar";
import { TOOL_CATALOG, type ToolId } from "./catalog";
import "./tools.css";

const PREFERENCES_KEY = "dssh.tools.shortcuts.v1";
const COLLAPSED_KEY = "dssh.tools.collapsedCategories.v1";
const toolIds = new Set<string>(TOOL_CATALOG.map(({ id }) => id));
const categories = [...new Set(TOOL_CATALOG.map(({ category }) => category))];
type Tool = typeof TOOL_CATALOG[number];
type ToolCategory = Tool["category"];
const categoryIcons: Record<ToolCategory, IconName> = {
  "数据与配置": "fileBraces",
  "文本与图片": "fileText",
  "编码与生成": "code",
  "运维": "terminalTool",
  "Web 与认证": "globe",
  "安全与密码学": "shield",
  "参考与计算": "gauge",
};
const filters = [
  { id: "all", label: "全部工具" },
  { id: "favorites", label: "收藏" },
  { id: "recent", label: "最近使用" },
] as const;
type Filter = typeof filters[number]["id"];
interface ToolPreferences {
  favorites: ToolId[];
  recent: ToolId[];
}

function knownIds(value: unknown): ToolId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is ToolId => typeof id === "string" && toolIds.has(id)))];
}

function loadPreferences(): ToolPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    return { favorites: knownIds(saved?.favorites), recent: knownIds(saved?.recent).slice(0, 5) };
  } catch {
    return { favorites: [], recent: [] };
  }
}

function loadCollapsedCategories(): Set<ToolCategory> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? categories.filter((category) => saved.includes(category)) : []);
  } catch {
    return new Set();
  }
}

export function ToolsWorkspace({ active, selected, onSelect }: {
  active: boolean;
  selected: ToolId;
  onSelect: (id: ToolId) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const [searchHovered, setSearchHovered] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchExpanded = searchHovered || searchFocused || Boolean(query);
  const groupId = useId();
  const [collapsedCategories, setCollapsedCategories] = useState(loadCollapsedCategories);
  const [visited, setVisited] = useState<ToolId[]>([selected]);
  const [preferences, setPreferences] = useState(loadPreferences);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [selected]);
  if (active && !visited.includes(selected)) setVisited([...visited, selected]);

  useEffect(() => {
    function receive(event: StorageEvent) {
      if (event.key === PREFERENCES_KEY) setPreferences(loadPreferences());
      if (event.key === COLLAPSED_KEY) setCollapsedCategories(loadCollapsedCategories());
    }
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, []);

  useEffect(() => {
    if (!active) return;
    const saved = loadPreferences();
    const recent = [selected, ...saved.recent.filter((id) => id !== selected)].slice(0, 5);
    const next = { ...saved, recent };
    setPreferences(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // The current window can still use the tools without persistent preferences.
    }
  }, [active, selected]);

  const current = TOOL_CATALOG.find((tool) => tool.id === selected)!;
  const favorite = preferences.favorites.includes(selected);

  function toggleFavorite() {
    const saved = loadPreferences();
    const favorites = favorite
      ? saved.favorites.filter((id) => id !== selected)
      : [...new Set([...saved.favorites, selected])];
    const next = { ...saved, favorites };
    setPreferences(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Keep the current window's selection available.
    }
  }

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = TOOL_CATALOG.filter((tool) =>
    terms.every((term) => `${tool.label} ${tool.category} ${tool.keywords}`.toLowerCase().includes(term)),
  );
  const filtered = filter === "all" ? matches : preferences[filter].flatMap((id) =>
    matches.filter((tool) => tool.id === id),
  );
  const emptyMessage = terms.length ? "没有匹配的工具。"
    : filter === "favorites" ? "收藏的工具会显示在这里。"
    : "最近打开的工具会显示在这里。";

  function toggleCategory(category: ToolCategory) {
    const next = new Set(collapsedCategories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    setCollapsedCategories(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      // Keep the disclosure state in the current window.
    }
  }

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  function toolRows(tools: readonly Tool[]) {
    return tools.map((tool) => (
      <button className="tools-workspace__item" key={tool.id} type="button"
        aria-current={selected === tool.id ? "page" : undefined} onClick={() => onSelect(tool.id)}>
        {tool.label}
      </button>
    ));
  }

  return (
    <section className="tools-workspace" aria-label="工具箱" hidden={!active}>
      <div className="tools-workspace__layout">
        <nav className="tools-workspace__catalog" aria-label="工具目录">
          <div className="tools-workspace__catalog-head">
            <div className="tools-workspace__catalog-top" data-search-expanded={searchExpanded}>
              <h1>工具箱</h1>
              <div className="tools-workspace__search" data-expanded={searchExpanded}
                onMouseEnter={() => setSearchHovered(true)} onMouseLeave={() => setSearchHovered(false)}
                onFocusCapture={() => setSearchFocused(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setSearchFocused(false);
                }}>
                <IconButton label="搜索工具" aria-expanded={searchExpanded} aria-controls={searchId}
                  onClick={() => searchRef.current?.focus()}><Icon name="search" /></IconButton>
                <input ref={searchRef} id={searchId} type="text" role="searchbox" aria-label="搜索工具" placeholder="搜索工具"
                  tabIndex={searchExpanded ? 0 : -1} aria-hidden={!searchExpanded}
                  autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    if (query) clearSearch();
                    else event.currentTarget.blur();
                  }} />
                {query ? <IconButton label="清除搜索" onClick={clearSearch}><Icon name="close" /></IconButton> : null}
              </div>
            </div>
            <SegmentedControl
              label="筛选工具"
              value={filter}
              onChange={setFilter}
              options={filters.map(({ id, label }) => ({
                value: id, label,
                content: id === "all" ? "全部" : id === "recent" ? "最近" : label,
              }))}
            />
          </div>
          <div className="tools-workspace__groups">
            {!filtered.length ? <p className="tools-workspace__empty" role="status">{emptyMessage}</p>
              : categories.map((category, index) => {
                const group = filtered.filter((tool) => tool.category === category);
                if (!group.length) return null;

                const searching = terms.length > 0;
                const expanded = searching || !collapsedCategories.has(category);
                const itemsId = `${groupId}-category-${index}`;
                const heading = <><Icon name={categoryIcons[category]} /> {category}</>;
                return (
                  <section className="tools-workspace__group" key={category} aria-label={category}>
                    <h2>
                      {searching ? <span className="tools-workspace__category">{heading}</span> : (
                        <button
                          className="tools-workspace__category"
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={itemsId}
                          data-current={!expanded && group.some((tool) => tool.id === selected)}
                          onClick={() => toggleCategory(category)}
                        >
                          {heading}
                          <Icon className="tools-workspace__category-chevron" name={expanded ? "chevron-down" : "chevron-right"} />
                        </button>
                      )}
                    </h2>
                    <div className="tools-workspace__group-items" id={itemsId} hidden={!expanded}>{toolRows(group)}</div>
                  </section>
                );
              })}
          </div>
        </nav>
        <div className="tools-workspace__main">
            <WorkspaceToolbar label="工具" identity={<><Icon name={categoryIcons[current.category]} /><h2>{current.label}</h2></>}>
              <ToolAction variant="ghost" label={favorite ? "取消收藏" : "收藏工具"} icon="star" aria-pressed={favorite} onClick={toggleFavorite} />
            </WorkspaceToolbar>
          <div ref={contentRef} className="tools-workspace__body">
            {TOOL_CATALOG.filter((tool) => visited.includes(tool.id)).map(({ id, component: ToolPage }) => (
              <div className="tools-workspace__page" key={id} hidden={id !== selected}>
                <Suspense fallback={<p role="status">正在加载工具…</p>}>
                  <ToolPage />
                </Suspense>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
