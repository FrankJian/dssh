import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { relativeSearchPath, type SearchProgress } from "./recursiveSearch";
import type { RecursiveSearchStatus } from "./useRecursiveFileSearch";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import type { LocalRoot } from "../services/sftpService";
import {
  formatSize,
  type BrowserEntry,
  type BrowserSide,
  type SortKey,
  type DirectoryHistory,
} from "./fileBrowserModel";

export interface FilePaneProps {
  side: BrowserSide;
  connectionName?: string;
  connectionAddress?: string;
  entries: BrowserEntry[];
  totalCount: number;
  isLoading: boolean;
  disabled: boolean;
  mutationsDisabled: boolean;
  path: string;
  currentPath: string;
  search: string;
  recursive: boolean;
  searchState: SearchProgress & {
    active: boolean;
    status: RecursiveSearchStatus;
    cancel: () => void;
    restart: () => void;
  };
  onRecursive: () => void;
  onReveal: (entry: BrowserEntry) => void;
  selectedPaths: Set<string>;
  roots?: LocalRoot[];
  history: DirectoryHistory;
  showHidden: boolean;
  sort: { key: SortKey; descending: boolean };
  onHistory: (index: number) => void;
  onNavigate: (path: string) => void;
  onPathSubmit: () => void;
  atRoot: boolean;
  onRefresh: () => void;
  onUp: () => void;
  onHome: () => void;
  onSelect: (
    entry: BrowserEntry,
    event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) => void;
  onSelection: (paths: Set<string>) => void;
  onEnter: (entry: BrowserEntry) => void;
  onCreate: (file: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
  onTransfer: () => void;
  onDownloadAs?: () => void;
  onCopy: () => void;
  onBeginDrag: (
    event: PointerEvent<HTMLElement>,
    name: string,
    paths: string[],
  ) => void;
  isDropTarget: boolean;
  isExternalDropTarget?: boolean;
  onSort: (key: SortKey) => void;
  onHidden: () => void;
  setSearch: (value: string) => void;
  setPath: (value: string) => void;
}
export function FilePane(p: FilePaneProps) {
  const title = p.side === "remote" ? "服务器" : "本机";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const paneRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusPath = useRef<string | null>(null);
  const selected = p.entries.filter((entry) => p.selectedPaths.has(entry.path));
  const mutationsLocked =
    p.disabled || p.isLoading || p.mutationsDisabled || !p.currentPath;
  const locked = p.disabled || p.isLoading || !p.currentPath;
  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: "名称" },
    { key: "size", label: "大小" },
    { key: "modified", label: "修改时间" },
  ];
  useEffect(() => {
    if (!menu) return;
    // WebKit can report a null blur target when clicking a button. Dismissing
    // on pane blur would unmount the menu before that button receives click.
    const closeOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        setMenu(null);
    };
    const close = () => setMenu(null);
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  return (
    <section
      ref={paneRef}
      className="sftp-dual-browser__pane"
      data-drop={p.isDropTarget}
      data-sftp-native-side={p.side}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect =
            p.side === "remote" && !mutationsLocked ? "copy" : "none";
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      aria-label={`${title}文件列表`}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        const input =
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement;
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "l"
        ) {
          event.preventDefault();
          pathRef.current?.focus();
          pathRef.current?.select();
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          searchRef.current?.focus();
          return;
        }
        if (event.key === "Escape" && menu) {
          event.preventDefault();
          setMenu(null);
          return;
        }
        if (input || menu) return;
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "a"
        ) {
          event.preventDefault();
          p.onSelection(new Set(p.entries.map((entry) => entry.path)));
        } else if (event.key === "Escape") p.onSelection(new Set());
        else if (event.altKey && event.key === "ArrowUp") {
          event.preventDefault();
          if (!locked && !p.atRoot) p.onUp();
        } else if (event.key === "F5") {
          event.preventDefault();
          if (!locked) p.onRefresh();
        } else if (
          event.key === "F2" &&
          selected.length === 1 &&
          !mutationsLocked
        ) {
          event.preventDefault();
          p.onRename();
        } else if (
          event.key === "Delete" &&
          selected.length &&
          !mutationsLocked
        ) {
          event.preventDefault();
          p.onDelete();
        } else if (
          event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          event.preventDefault();
          const index = p.entries.findIndex(
            (entry) => entry.path === focusPath.current,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? p.entries.length - 1
                : Math.max(
                    0,
                    Math.min(
                      p.entries.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
          const entry = p.entries[next];
          if (entry) {
            focusPath.current = entry.path;
            p.onSelect(entry, event);
            paneRef.current
              ?.querySelectorAll<HTMLButtonElement>("[role=option]")
              [next]?.focus();
          }
        }
      }}
    >
      <header className="sftp-dual-browser__pane-header">
        <span
          className="sftp-dual-browser__identity"
          title={
            p.side === "remote"
              ? [p.connectionName || title, p.connectionAddress, "SFTP"]
                  .filter(Boolean)
                  .join(" · ")
              : "本机文件"
          }
        >
          <Icon
            name={p.side === "remote" ? "server" : "monitor"}
            height="16"
            width="16"
          />
          <span className="sftp-dual-browser__identity-copy">
            <strong>
              {p.side === "remote"
                ? p.connectionName || p.connectionAddress || title
                : title}
            </strong>
            <small>
              {p.side === "remote" ? p.connectionAddress || "SFTP" : "本地文件"}
            </small>
          </span>
        </span>
        <div>
          <IconButton disabled={locked} label="返回主目录" onClick={p.onHome}>
            <Icon name="house" />
          </IconButton>
          <IconButton
            disabled={mutationsLocked}
            label="新建目录"
            onClick={() => p.onCreate(false)}
          >
            <Icon name="folderPlus" />
          </IconButton>
          <IconButton
            disabled={mutationsLocked}
            label="新建文件"
            onClick={() => p.onCreate(true)}
          >
            <Icon name="filePlus" />
          </IconButton>
          <IconButton disabled={locked} label="刷新 (F5)" onClick={p.onRefresh}>
            <Icon name="refresh" />
          </IconButton>
        </div>
      </header>
      <form
        className="sftp-dual-browser__path"
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked && p.path.trim()) p.onPathSubmit();
        }}
      >
        <IconButton
          label="后退"
          disabled={locked || p.history.index <= 0}
          onClick={() => p.onHistory(p.history.index - 1)}
        >
          <Icon name="arrowLeft" />
        </IconButton>
        <IconButton
          label="前进"
          disabled={locked || p.history.index >= p.history.paths.length - 1}
          onClick={() => p.onHistory(p.history.index + 1)}
        >
          <Icon name="arrowRight" />
        </IconButton>
        <IconButton
          label="上一级目录 (Alt+↑)"
          disabled={locked || p.atRoot}
          onClick={p.onUp}
        >
          <Icon name="arrowUp" />
        </IconButton>
        <input
          ref={pathRef}
          aria-label={`${title}路径`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              p.setPath(p.currentPath);
            }
          }}
          onChange={(event) => p.setPath(event.currentTarget.value)}
          spellCheck={false}
          value={p.path}
        />
        <button
          type="submit"
          disabled={locked}
          title="前往目录"
          aria-label="前往目录"
        >
          <Icon name="chevron-right" width="14" height="14" />
        </button>
      </form>
      <div className="sftp-dual-browser__filters">
        <label className="sftp-dual-browser__search">
          <Icon name="search" height="14" width="14" />
          <input
            ref={searchRef}
            aria-label={
              p.recursive ? `递归搜索${title}文件` : `搜索${title}当前目录`
            }
            onChange={(event) => p.setSearch(event.currentTarget.value)}
            placeholder={p.recursive ? "模糊搜索文件及子目录…" : "筛选文件…"}
            type="search"
            value={p.search}
          />
        </label>
        <label
          className="sftp-dual-browser__recursive-toggle"
          title="递归搜索子目录，按文件名和相对路径模糊匹配（不搜索文件内容）"
        >
          <input
            type="checkbox"
            checked={p.recursive}
            onChange={p.onRecursive}
            aria-label={`${title}递归搜索`}
          />
          <span>递归搜索</span>
        </label>
        <button
          className="sftp-dual-browser__toggle"
          type="button"
          aria-label="显示隐藏文件"
          aria-pressed={p.showHidden}
          onClick={p.onHidden}
          title="显示隐藏文件"
        >
          <Icon name="eye" width="15" height="15" />
        </button>
        {p.roots ? (
          <select
            aria-label="本机常用位置"
            disabled={locked}
            value=""
            onChange={(event) => p.onNavigate(event.currentTarget.value)}
          >
            <option disabled value="">
              常用位置
            </option>
            {p.roots.map((root) => (
              <option key={root.path} value={root.path}>
                {root.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {p.searchState.active ? (
        <div
          className="sftp-dual-browser__search-status"
          role="status"
          title={p.searchState.error ?? undefined}
        >
          <span>
            {p.searchState.status === "pending"
              ? "等待输入…"
              : p.searchState.status === "searching"
                ? "搜索中"
                : p.searchState.status === "cancelled"
                  ? "搜索已停止"
                  : p.searchState.status === "limited"
                    ? "已达搜索上限，请缩小范围"
                    : p.searchState.status === "error"
                      ? "搜索失败"
                      : "搜索完成"}{" "}
            · {p.entries.length} 项 · 已检查 {p.searchState.directories} 个目录
            {p.searchState.skipped
              ? ` · ${p.searchState.skipped} 个目录无法读取`
              : ""}
          </span>
          {p.searchState.status === "pending" ||
          p.searchState.status === "searching" ? (
            <button type="button" onClick={p.searchState.cancel}>
              停止
            </button>
          ) : (
            <button type="button" onClick={p.searchState.restart}>
              重新搜索
            </button>
          )}
        </div>
      ) : null}
      <div className="sftp-dual-browser__actions">
        <button
          type="button"
          disabled={mutationsLocked || !selected.length}
          onClick={p.onTransfer}
        >
          <Icon
            name={p.side === "remote" ? "download" : "upload"}
            width="14"
            height="14"
          />
          {p.side === "remote" ? "下载" : "上传"}
          {selected.length ? ` (${selected.length})` : ""}
        </button>
        {p.onDownloadAs ? (
          <button
            type="button"
            disabled={mutationsLocked || !selected.length}
            onClick={p.onDownloadAs}
          >
            下载到…
          </button>
        ) : null}
        <IconButton
          label="重命名 (F2)"
          disabled={mutationsLocked || selected.length !== 1}
          onClick={p.onRename}
        >
          <Icon name="edit" width="14" height="14" />
        </IconButton>
        <IconButton
          label="复制所选路径"
          disabled={!selected.length}
          onClick={p.onCopy}
        >
          <Icon name="copy" width="14" height="14" />
        </IconButton>
        <IconButton
          label="删除所选项目"
          disabled={mutationsLocked || !selected.length}
          onClick={p.onDelete}
        >
          <Icon name="trash" width="14" height="14" />
        </IconButton>
      </div>
      <div className="sftp-dual-browser__columns">
        {columns.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => p.onSort(key)}
            aria-label={`按${label}${p.sort.key === key && !p.sort.descending ? "降序" : "升序"}排序`}
          >
            {label}
            {p.sort.key === key ? (
              <span>{p.sort.descending ? "↓" : "↑"}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        aria-label={`${title}目录内容`}
        onClick={(event) => {
          if (event.target === event.currentTarget) p.onSelection(new Set());
        }}
        aria-busy={
          p.isLoading ||
          p.searchState.status === "pending" ||
          p.searchState.status === "searching"
        }
        aria-multiselectable="true"
        className="sftp-dual-browser__list"
        role="listbox"
        tabIndex={0}
        data-sftp-drop-side={p.side}
      >
        {p.isLoading ? (
          <div className="sftp-dual-browser__empty">
            <Icon name="refresh" />
            <span>正在读取目录…</span>
          </div>
        ) : p.entries.length === 0 ? (
          <div className="sftp-dual-browser__empty">
            <Icon
              name={p.search ? "search" : "folder"}
              width="28"
              height="28"
            />
            <strong>
              {p.searchState.status === "pending" ||
              p.searchState.status === "searching"
                ? "正在搜索子目录…"
                : p.search
                  ? "没有匹配的项目"
                  : "此目录暂无文件"}
            </strong>
            <span>
              {p.search
                ? "尝试其他关键词或显示隐藏文件"
                : "将另一侧的文件拖到这里，或新建文件夹"}
            </span>
          </div>
        ) : (
          p.entries.map((entry) => (
            <button
              aria-selected={p.selectedPaths.has(entry.path)}
              className="sftp-dual-browser__row"
              data-selected={p.selectedPaths.has(entry.path)}
              data-search-result={p.searchState.active}
              key={entry.path}
              onClick={(event) => {
                focusPath.current = entry.path;
                p.onSelect(entry, event);
              }}
              onDoubleClick={() => {
                if (!locked) p.onEnter(entry);
              }}
              role="option"
              title={`${entry.path}${entry.isSymlink ? " · 符号链接" : ""}`}
              type="button"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!locked) p.onEnter(entry);
                }
              }}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (mutationsLocked) return;
                const paths = p.selectedPaths.has(entry.path)
                  ? selected.map((item) => item.path)
                  : [entry.path];
                p.onBeginDrag(event, entry.name, paths);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!p.selectedPaths.has(entry.path))
                  p.onSelection(new Set([entry.path]));
                menuTriggerRef.current = event.currentTarget;
                focusPath.current = entry.path;
                event.currentTarget.focus();
                const rect = paneRef.current!.getBoundingClientRect();
                setMenu({
                  x: Math.max(
                    0,
                    Math.min(event.clientX - rect.left, rect.width - 180),
                  ),
                  y: Math.max(
                    0,
                    Math.min(event.clientY - rect.top, rect.height - 220),
                  ),
                });
              }}
            >
              <span className="sftp-dual-browser__name">
                <Icon
                  name={
                    entry.isDir
                      ? "folder"
                      : /\.(png|jpe?g|webp|gif|svg)$/i.test(entry.name)
                        ? "fileImage"
                        : /\.(zip|tgz|gz|tar|7z)$/i.test(entry.name)
                          ? "fileArchive"
                          : "fileText"
                  }
                  height="16"
                  width="16"
                />
                <span className="sftp-dual-browser__filename">
                  <span>{entry.name}</span>
                  {p.searchState.active ? (
                    <small>
                      {relativeSearchPath(entry.path, p.currentPath, p.side)}
                    </small>
                  ) : null}
                </span>
                {entry.isSymlink ? (
                  <Icon name="arrowDownRight" width="12" height="12" />
                ) : null}
              </span>
              <small>{entry.isDir ? "—" : formatSize(entry.size)}</small>
              <time>
                {entry.modified === null
                  ? "—"
                  : new Date(entry.modified * 1000).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
              </time>
            </button>
          ))
        )}
      </div>
      {p.isExternalDropTarget ? (
        <div className="sftp-dual-browser__native-drop-hint" role="status">
          <Icon name="upload" width="16" height="16" />
          <span>松开上传到 {p.currentPath}</span>
        </div>
      ) : null}
      <footer className="sftp-dual-browser__pane-status">
        <span>
          {p.searchState.active
            ? `找到 ${p.entries.length} 项 / 检查 ${p.totalCount} 项`
            : `${p.entries.length} / ${p.totalCount} 项`}
          {selected.length
            ? ` · 已选 ${selected.length} 项 · ${formatSize(selected.filter((entry) => !entry.isDir).reduce((size, entry) => size + entry.size, 0))}`
            : ""}
        </span>
        <span title="Ctrl/⌘ 多选 · Shift 连选 · ↑↓ 导航">多选 / 拖拽传输</span>
      </footer>
      {menu ? (
        <div
          className="sftp-dual-browser__menu-cover"
          onMouseDown={() => setMenu(null)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setMenu(null);
              menuTriggerRef.current?.focus();
            } else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ) ?? [],
              );
              const index = items.findIndex(
                (item) => item === document.activeElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          <div
            ref={menuRef}
            className="sftp-dual-browser__menu"
            role="menu"
            aria-label={`${title}文件操作`}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              role="menuitem"
              disabled={locked || selected.length !== 1}
              onClick={() => {
                p.onEnter(selected[0]);
                setMenu(null);
              }}
            >
              打开 / 编辑
            </button>
            {p.searchState.active ? (
              <button
                role="menuitem"
                disabled={locked || selected.length !== 1}
                onClick={() => {
                  p.onReveal(selected[0]);
                  setMenu(null);
                }}
              >
                打开所在目录
              </button>
            ) : null}
            <button
              role="menuitem"
              disabled={mutationsLocked}
              onClick={() => {
                p.onTransfer();
                setMenu(null);
              }}
            >
              {p.side === "remote"
                ? "下载到本机当前目录"
                : "上传到服务器当前目录"}
            </button>
            <button
              role="menuitem"
              disabled={mutationsLocked || selected.length !== 1}
              onClick={() => {
                p.onRename();
                setMenu(null);
              }}
            >
              重命名 <kbd>F2</kbd>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                p.onCopy();
                setMenu(null);
              }}
            >
              复制路径
            </button>
            <button
              role="menuitem"
              disabled={mutationsLocked}
              onClick={() => {
                p.onDelete();
                setMenu(null);
              }}
            >
              删除… <kbd>Del</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
