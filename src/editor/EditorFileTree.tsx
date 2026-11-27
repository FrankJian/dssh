import { useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { SftpEntry } from "../services/sftpService";
import { EditorFileProvider } from "./fileProvider";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { isWindowsLocalPath } from "../sftp/browserPaths";
import { editorBaseName } from "./editorPaths";
import { FileEntryIcon } from "../sftp/FileEntryIcon";
import type { EditorMenuAnchor } from "./EditorContextMenu";
import { IconButton } from "../ui/IconButton";
import { EditorRefreshButton } from "./EditorRefreshButton";

interface Directory { entries?: SftpEntry[]; loading?: boolean; error?: string; truncated?: boolean }
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export function editorSortedEntries(entries: SftpEntry[], showHidden: boolean) {
  return entries.filter((entry) => showHidden || !entry.name.startsWith(".")).sort((a, b) => Number(b.isDir) - Number(a.isDir) || natural.compare(a.name, b.name));
}
export interface EditorFileTreeHandle { reveal(path: string, options?: { focus?: boolean }): Promise<void> }
interface TreeProps {
  ref?: Ref<EditorFileTreeHandle>;
  provider: EditorFileProvider;
  refreshRevision?: number;
  activePath: string | null;
  onOpen(path: string, fixed: boolean): void;
  onSelect?: (entries: SftpEntry[]) => void;
  enabled?: boolean;
  onContextMenu?(entries: SftpEntry[], anchor: EditorMenuAnchor): void;
  onCreate?(kind: "createFile" | "createDirectory", entries: SftpEntry[]): void;
}

export function EditorFileTree({ provider, activePath, onOpen, onSelect, refreshRevision = 0, ref, enabled = true, onContextMenu, onCreate }: TreeProps) {
  const root = provider.workspace.rootPath;
  const [directories, setDirectories] = useState<Record<string, Directory>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(root ? [root] : []));
  const [showHidden, setShowHidden] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const pendingReveal = useRef<{ path: string; focus: boolean } | null>(null);
  const revealGeneration = useRef(0);
  const anchor = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const requests = useRef(new Map<string, number>());
  const alive = useRef(true);
  const tree = useRef<HTMLDivElement>(null);
  const refreshGeneration = useRef(0);
  const [viewport, setViewport] = useState({ top: 0, height: 400 });
  const selectedPaths = useMemo(() => new Set(selection), [selection]);
  useEffect(() => {
    const element = tree.current; if (!element) return;
    const observer = new ResizeObserver(() => setViewport((current) => ({ ...current, height: element.clientHeight })));
    observer.observe(element); return () => observer.disconnect();
  }, [root]);

  async function load(path: string) {
    const version = ++requestSequence.current;
    requests.current.set(path, version);
    setDirectories((current) => ({ ...current, [path]: { ...current[path], loading: true, error: undefined } }));
    try {
      const listing = await provider.list(path);
      if (alive.current && requests.current.get(path) === version) setDirectories((current) => {
        const entries = listing.entries.slice(0, 10_000);
        let count = entries.length; let characters = path.length + entries.reduce((size, entry) => size + entry.path.length + entry.name.length, 0);
        for (const [key, directory] of Object.entries(current)) if (key !== path) { count += directory.entries?.length ?? 0; characters += key.length + (directory.entries?.reduce((size, entry) => size + entry.path.length + entry.name.length, 0) ?? 0); }
        if (count > 50_000 || characters > 8 * 1024 * 1024) return { ...current, [path]: { ...current[path], loading: false, error: "文件树缓存达到上限，请关闭不需要的目录或打开较小的工作区。" } };
        return { ...current, [path]: { entries, truncated: listing.truncated || listing.entries.length > entries.length } };
      });
    } catch (error) {
      if (alive.current && requests.current.get(path) === version) setDirectories((current) => ({ ...current, [path]: { ...current[path], loading: false, error: error instanceof Error ? error.message : "读取目录失败。" } }));
    }
  }
  useEffect(() => {
    alive.current = true;
    setRefreshing(false);
    if (root) void load(root);
    return () => { alive.current = false; requests.current.clear(); ++refreshGeneration.current; ++revealGeneration.current; };
  }, [provider, root]);

  async function refreshTree() {
    const generation = ++refreshGeneration.current;
    setRefreshing(true);
    // Evict collapsed directories so refreshing can recover cache capacity.
    setDirectories((current) => Object.fromEntries(Object.entries(current).filter(([path]) => path === root || expanded.has(path))));
    try {
      for (const path of new Set(root ? [root, ...expanded] : [])) { if (!alive.current || generation !== refreshGeneration.current) return; await load(path); }
    } finally {
      if (alive.current && generation === refreshGeneration.current) setRefreshing(false);
    }
  }
  useEffect(() => { if (refreshRevision && root) void refreshTree(); }, [refreshRevision]);

  const rows = useMemo(() => {
    const result: Array<{ entry: SftpEntry; depth: number; parent: string }> = [];
    const visit = (parent: string, depth: number) => {
      for (const entry of editorSortedEntries(directories[parent]?.entries ?? [], showHidden)) {
        result.push({ entry, depth, parent });
        if (depth < 64 && entry.isDir && !entry.isSymlink && expanded.has(entry.path)) visit(entry.path, depth + 1);
      }
    };
    if (root) visit(root, 1);
    return result;
  }, [directories, expanded, showHidden, root]);

  const offsets = useMemo(() => {
    const values = [0];
    for (const { entry } of rows) { const directory = expanded.has(entry.path) ? directories[entry.path] : undefined;
      values.push(values[values.length - 1] + 28 + (directory?.loading ? 28 : 0) + (directory?.error ? 64 : 0) + (directory?.truncated ? 44 : 0)); }
    return values;
  }, [rows, directories, expanded]);
  function atOffset(offset: number) {
    let start = 0; let end = rows.length;
    while (start < end) { const middle = (start + end) >>> 1; if (offsets[middle + 1] < offset) start = middle + 1; else end = middle; }
    return start;
  }
  const start = Math.max(0, atOffset(viewport.top) - 8);
  const end = Math.min(rows.length, atOffset(viewport.top + viewport.height) + 9);
  const focusedIndex = rows.findIndex(({ entry }) => entry.path === focused);

  useEffect(() => {
    const visible = new Set(rows.map(({ entry }) => entry.path));
    setSelection((current) => current.some((path) => !visible.has(path)) ? current.filter((path) => visible.has(path)) : current);
    if (focused && !visible.has(focused)) setFocused(rows[0]?.entry.path ?? null);
    const target = pendingReveal.current;
    if (target && visible.has(target.path)) { pendingReveal.current = null; setSelection([target.path]); setFocused(target.path); if (target.focus) focus(target.path); }
  }, [rows]);
  useEffect(() => { onSelect?.(rows.filter(({ entry }) => selectedPaths.has(entry.path)).map(({ entry }) => entry)); }, [selection, rows, onSelect]);

  function toggle(entry: SftpEntry) {
    if (!entry.isDir || entry.isSymlink) return;
    if (!expanded.has(entry.path) && (rows.find((row) => row.entry.path === entry.path)?.depth ?? 0) >= 64) { setDirectories((current) => ({ ...current, [entry.path]: { ...current[entry.path], error: "文件树最多展开 64 层，请将此目录作为新工作区打开。" } })); setExpanded((current) => new Set([...current, entry.path])); return; }
    const closing = expanded.has(entry.path);
    if (closing) {
      const separator = provider.workspace.source.kind === "local" && isWindowsLocalPath(entry.path) ? "\\" : "/";
      for (const path of requests.current.keys()) if (path === entry.path || path.startsWith(`${entry.path}${separator}`)) requests.current.set(path, (requests.current.get(path) ?? 0) + 1);
      setDirectories((current) => Object.fromEntries(Object.entries(current).filter(([path]) => path !== entry.path && !path.startsWith(`${entry.path}${separator}`))));
    }
    setExpanded((current) => { const next = new Set(current); if (next.has(entry.path)) { const separator = provider.workspace.source.kind === "local" && isWindowsLocalPath(entry.path) ? "\\" : "/"; for (const path of next) if (path === entry.path || path.startsWith(`${entry.path}${separator}`)) next.delete(path); } else next.add(entry.path); return next; });
    if (!closing && !directories[entry.path]?.entries && !directories[entry.path]?.loading) void load(entry.path);
  }
  function select(path: string, multiple = false, range = false) {
    const visible = rows.map(({ entry }) => entry.path);
    setSelection((current) => {
      const start = anchor.current ? visible.indexOf(anchor.current) : -1; const end = visible.indexOf(path);
      if (range && start >= 0 && end >= 0) return visible.slice(Math.min(start, end), Math.max(start, end) + 1);
      if (multiple) return current.includes(path) ? current.filter((id) => id !== path) : [...current, path];
      return [path];
    });
    if (!range) anchor.current = path;
    setFocused(path);
  }
  function focus(path: string) {
    setFocused(path);
    const index = rows.findIndex(({ entry }) => entry.path === path); const element = tree.current;
    if (index >= 0 && element) {
      const top = offsets[index]; const bottom = offsets[index + 1];
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
      setViewport((current) => ({ ...current, top: element.scrollTop }));
    }
    requestAnimationFrame(() => {
      const element = Array.from(tree.current?.querySelectorAll<HTMLElement>("[data-path]") ?? []).find((item) => item.dataset.path === path);
      element?.focus(); element?.scrollIntoView({ block: "nearest" });
    });
  }
  function context(entries: SftpEntry[], target: HTMLElement, x: number, y: number) {
    if (!enabled || !onContextMenu) return;
    if (!entries.length) setSelection([]);
    else if (!selectedPaths.has(entries[0].path)) { select(entries[0].path); }
    onContextMenu(entries, { x, y, target });
  }
  function contextEntries(entry: SftpEntry) { return selectedPaths.has(entry.path) ? rows.filter((row) => selectedPaths.has(row.entry.path)).map((row) => row.entry) : [entry]; }
  function key(event: KeyboardEvent, index: number) {
    const row = rows[index]; if (!row) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault(); event.stopPropagation(); const target = event.currentTarget as HTMLElement; const bounds = target.getBoundingClientRect();
      context(contextEntries(row.entry), target, bounds.left + 20, bounds.bottom); return;
    }
    const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); select(rows[next].entry.path, false, event.shiftKey); focus(rows[next].entry.path); }
    else if (event.key === "ArrowRight") {
      event.preventDefault(); if (!expanded.has(row.entry.path)) toggle(row.entry); else if (rows[index + 1]?.parent === row.entry.path) focus(rows[index + 1].entry.path);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault(); if (expanded.has(row.entry.path)) toggle(row.entry); else if (row.parent !== root) focus(row.parent);
    } else if (event.key === "Enter") { event.preventDefault(); if (row.entry.isDir) toggle(row.entry); else onOpen(row.entry.path, true); }
    else if (event.key === " ") { event.preventDefault(); select(row.entry.path, event.ctrlKey || event.metaKey, event.shiftKey); }
  }

  async function reveal(path: string, options?: { focus?: boolean }) {
    if (!root) return;
    const focusRequested = options?.focus !== false;
    const generation = ++revealGeneration.current;
    const windows = provider.workspace.source.kind === "local" && isWindowsLocalPath(root);
    const normalize = (value: string) => (windows ? value.replace(/\\/g, "/") : value).replace(/\/$/, "");
    const normalizedRoot = normalize(root); const normalizedPath = normalize(path);
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}/`)) return;
    const parts = normalizedPath.slice(normalizedRoot.length).split("/").filter(Boolean);
    if (parts.length > 64) { setNotice("路径超过文件树的 64 层展开上限，请打开较小的工作区。"); return; }
    setNotice(null);
    // Revealing an explicitly opened hidden path also makes it visible in the tree.
    if (parts.some((part) => part.startsWith("."))) setShowHidden(true);
    pendingReveal.current = { path, focus: focusRequested };
    let parent = root;
    setExpanded((current) => new Set([...current, root]));
    await load(root);
    for (const part of parts.slice(0, -1)) {
      if (!alive.current || generation !== revealGeneration.current) return;
      parent = `${parent.replace(windows ? /[\\/]$/ : /\/$/, "")}${windows ? "\\" : "/"}${part}`;
      const expandedPath = parent;
      setExpanded((current) => new Set([...current, expandedPath]));
      await load(parent);
    }
    if (alive.current && generation === revealGeneration.current) {
      if (!parts.length) { pendingReveal.current = null; if (focusRequested) tree.current?.focus(); }
      else if (rows.some(({ entry }) => entry.path === path)) { pendingReveal.current = null; select(path); if (focusRequested) focus(path); }
    }
  }
  useImperativeHandle(ref, () => ({ reveal }));

  if (!root) return <div className="editor-empty">打开文件夹以浏览文件。</div>;
  return <aside className="editor-explorer" aria-label="资源管理器">
    <header className="editor-explorer__header" title={root} role="group" aria-label="项目根目录" tabIndex={0} onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); context([], event.currentTarget, bounds.left + 20, bounds.bottom); }
    }} onContextMenu={(event) => { event.preventDefault(); context([], tree.current ?? event.currentTarget, event.clientX, event.clientY); }}><strong title={root}>{editorBaseName(provider.workspace.source, root)}</strong>
      <span className="editor-explorer__actions" role="group" aria-label="新建项目">
        <IconButton label="在当前目录新建文件" disabled={!enabled} onClick={() => onCreate?.("createFile", rows.filter((row) => selectedPaths.has(row.entry.path)).map((row) => row.entry))}><Icon name="fileAdd" width="16" height="16" /></IconButton>
        <IconButton label="在当前目录新建文件夹" disabled={!enabled} onClick={() => onCreate?.("createDirectory", rows.filter((row) => selectedPaths.has(row.entry.path)).map((row) => row.entry))}><Icon name="folderAdd" width="16" height="16" /></IconButton>
      </span>
      <span className="editor-explorer__actions" role="group" aria-label="文件树视图">
        <IconButton label="显示隐藏文件" disabled={!enabled} active={showHidden} onClick={() => setShowHidden((value) => !value)} aria-pressed={showHidden}><Icon name={showHidden ? "eye" : "eyeOff"} width="16" height="16" /></IconButton>
        <IconButton label="定位活动文件" disabled={!enabled || !activePath} onClick={() => activePath && void reveal(activePath)}><Icon name="locate" width="16" height="16" /></IconButton>
        <EditorRefreshButton label="刷新文件树" busy={refreshing} disabled={!enabled} onRefresh={() => void refreshTree()} />
      </span>
    </header>
    {notice ? <div className="editor-tree-limit" role="alert">{notice}<IconButton label="关闭文件树提示" onClick={() => setNotice(null)}><Icon name="close" /></IconButton></div> : null}
    {directories[root]?.truncated ? <div className="editor-tree-limit" role="status">目录项目过多，仅显示前 10,000 项。可打开较小目录或使用目录搜索。</div> : null}
    {directories[root]?.loading && !directories[root]?.entries ? <p role="status">正在加载目录…</p> : null}
    {directories[root]?.error ? <div className="editor-tree-limit" role="alert">{directories[root].error}<Button variant="ghost" onClick={() => void load(root)}>重试</Button></div> : null}
    <div onContextMenu={(event) => { event.preventDefault(); context([], event.currentTarget, event.clientX, event.clientY); }} onKeyDown={(event) => {
      if (event.target === event.currentTarget && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); context([], event.currentTarget, bounds.left + 20, bounds.top + 20); }
    }} onScroll={(event) => { const top = event.currentTarget.scrollTop; setViewport((current) => ({ ...current, top })); }} className="editor-explorer__tree" role="tree" aria-label="文件树" aria-multiselectable="true" tabIndex={rows.length ? -1 : 0} ref={tree}>
      {<div style={{ height: offsets[offsets.length - 1], position: "relative" }}>{rows.slice(start, end).map(({ entry, depth }, visibleIndex) => { const index = start + visibleIndex; return <div key={entry.path} style={{ position: "absolute", top: offsets[index], width: "100%" }}>
        <div role="treeitem" aria-level={depth} aria-selected={selectedPaths.has(entry.path)} aria-expanded={entry.isDir && !entry.isSymlink ? expanded.has(entry.path) : undefined}
          className={`editor-tree-row${selectedPaths.has(entry.path) ? " is-selected" : ""}`} data-path={entry.path} style={{ paddingLeft: depth * 14 }}
          tabIndex={focused === entry.path || ((focusedIndex < start || focusedIndex >= end) && index === start) ? 0 : -1}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); context(contextEntries(entry), event.currentTarget, event.clientX, event.clientY); }}
          onKeyDown={(event) => key(event, index)} onFocus={() => setFocused(entry.path)}
          onClick={(event) => { select(entry.path, event.ctrlKey || event.metaKey, event.shiftKey); if (entry.isDir) toggle(entry); else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onOpen(entry.path, false); }}
          onDoubleClick={() => { if (!entry.isDir) onOpen(entry.path, true); }} title={entry.path}>
          <span className="editor-tree-row__twist">{entry.isDir && !entry.isSymlink ? <Icon name={expanded.has(entry.path) ? "chevron-down" : "chevron-right"} width="14" height="14" /> : null}</span>
          <FileEntryIcon name={entry.name} directory={entry.isDir} expanded={expanded.has(entry.path)} symlink={entry.isSymlink} /><span>{entry.name}{entry.isSymlink ? " ↗" : ""}</span>
        </div>
        {expanded.has(entry.path) && directories[entry.path]?.loading ? <div className="editor-tree-feedback" style={{ height: 28 }} role="status">正在加载…</div> : null}
        {expanded.has(entry.path) && directories[entry.path]?.error ? <div className="editor-tree-feedback" style={{ height: 64, overflow: "auto" }} role="alert">{directories[entry.path].error}<Button variant="ghost" onClick={() => void load(entry.path)}>重试</Button></div> : null}
        {expanded.has(entry.path) && directories[entry.path]?.truncated ? <div className="editor-tree-limit" style={{ height: 44, overflow: "auto" }} role="status">此目录仅显示前 10,000 项，可打开较小目录或使用目录搜索。</div> : null}
      </div>; })}</div>}
      {!directories[root]?.loading && !directories[root]?.error && rows.length === 0 ? <p className="editor-empty">目录为空</p> : null}
    </div>
  </aside>;
}
