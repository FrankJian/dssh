import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { EditorRefreshButton } from "./EditorRefreshButton";
import { FileEntryIcon } from "../sftp/FileEntryIcon";
import type { SftpEntry } from "../services/sftpService";
import { EditorFileProvider } from "./fileProvider";
import { editorSortedEntries } from "./EditorFileTree";
import { editorParentPath, editorWithinRoot } from "./editorPaths";

interface Listing { loading: boolean; entries: SftpEntry[]; error?: string; truncated?: boolean }
const ROW_HEIGHT = 32;
const VIEW_HEIGHT = 288;

/** One directory at a time, bound to the source and editor group that owns the trigger. */
export function EditorBreadcrumbDirectory({ provider, path, label, disabled, onOpen }: {
  provider: EditorFileProvider; path: string; label: string; disabled: boolean; onOpen(path: string): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [directory, setDirectory] = useState(path);
  const [listing, setListing] = useState<Listing>({ loading: false, entries: [] });
  const [query, setQuery] = useState(""), [hidden, setHidden] = useState(false), [selected, setSelected] = useState(0), [scroll, setScroll] = useState(0);
  const generation = useRef(0), visible = useRef(false), permitted = useRef(!disabled); permitted.current = !disabled;
  const boundary = provider.workspace.rootPath && editorWithinRoot(provider.workspace.source, path, provider.workspace.rootPath) ? provider.workspace.rootPath : null;
  const parent = editorParentPath(provider.workspace.source, directory);
  const canBack = parent !== directory && (!boundary || editorWithinRoot(provider.workspace.source, parent, boundary));
  const entries = useMemo(() => editorSortedEntries(listing.entries, hidden).filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [listing.entries, hidden, query]);
  const height = Math.min(VIEW_HEIGHT, entries.length * ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - 2), end = Math.min(entries.length, Math.ceil((scroll + VIEW_HEIGHT) / ROW_HEIGHT) + 2);
  function dismiss(restore = false) {
    visible.current = false; generation.current++; setOpen(false);
    if (restore && permitted.current) trigger.current?.focus({ preventScroll: true });
  }
  async function load(next: string) {
    if (!permitted.current || !visible.current) return;
    const request = ++generation.current;
    search.current?.focus({ preventScroll: true });
    setDirectory(next); setQuery(""); setSelected(0); setScroll(0); if (list.current) list.current.scrollTop = 0;
    setListing({ loading: true, entries: [] });
    try {
      const result = await provider.list(next);
      if (!visible.current || !permitted.current || request !== generation.current) return;
      const bounded: SftpEntry[] = []; let characters = 0;
      for (const entry of result.entries) {
        if (entry.name === "." || entry.name === "..") continue;
        characters += entry.name.length + entry.path.length;
        if (bounded.length >= 10000 || characters > 8 * 1024 * 1024) break;
        bounded.push(entry);
      }
      setListing({ loading: false, entries: bounded, truncated: result.truncated || bounded.length < result.entries.length });
    } catch (reason) {
      if (visible.current && permitted.current && request === generation.current) setListing({ loading: false, entries: [], error: reason instanceof Error ? reason.message : "读取目录失败，请重试。" });
    }
  }
  function show() {
    if (!permitted.current) return;
    visible.current = true; setOpen(true); setHidden(false); void load(path);
  }
  function choose(entry: SftpEntry) {
    if (!permitted.current || !visible.current || (entry.isDir && entry.isSymlink)) return;
    if (entry.isDir) { void load(entry.path); search.current?.focus(); }
    else { dismiss(); onOpen(entry.path); }
  }
  function focus(index: number) {
    if (!entries.length) return;
    const available = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => !entry.isDir || !entry.isSymlink).map(({ index }) => index);
    if (!available.length) return;
    const next = index < selected ? [...available].reverse().find(value => value <= index) ?? available[0] : available.find(value => value >= index) ?? available[available.length - 1];
    setSelected(next);
    if (list.current) {
      const top = next * ROW_HEIGHT;
      if (top < list.current.scrollTop) list.current.scrollTop = top;
      else if (top + ROW_HEIGHT > list.current.scrollTop + list.current.clientHeight) list.current.scrollTop = top + ROW_HEIGHT - list.current.clientHeight;
      setScroll(list.current.scrollTop);
    }
    const target = popup.current?.querySelector<HTMLButtonElement>(`[data-breadcrumb-index="${next}"]`);
    if (target) target.focus({ preventScroll: true });
    else requestAnimationFrame(() => { if (visible.current && permitted.current) popup.current?.querySelector<HTMLButtonElement>(`[data-breadcrumb-index="${next}"]`)?.focus({ preventScroll: true }); });
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(true); return; }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); if (canBack) void load(parent); return; }
    const input = event.target === search.current;
    const row = (event.target as Element).closest("[data-breadcrumb-index]");
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || (!input && row && ["Home", "End"].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      focus(event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (input || !row) ? event.key === "ArrowDown" ? 0 : entries.length - 1 : selected + (event.key === "ArrowDown" ? 1 : -1));
    } else if ((input || row) && (event.key === "Enter" || (!input && event.key === "ArrowRight"))) {
      event.preventDefault(); event.stopPropagation(); if (entries[selected]) choose(entries[selected]);
    } else if (!input && row && event.key === "ArrowLeft" && canBack) { event.preventDefault(); event.stopPropagation(); void load(parent); search.current?.focus(); }
  }
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const bounds = trigger.current.getBoundingClientRect(), element = popup.current;
    element.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - element.offsetHeight - 8))}px`;
  }, [open, directory, listing, query, hidden]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) dismiss(); };
    const blur = () => dismiss();
    const scrolled = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) dismiss(); };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", blur); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scrolled, true); window.removeEventListener("resize", blur); window.removeEventListener("blur", blur); };
  }, [open]);
  useEffect(() => { if (disabled) dismiss(); }, [disabled]);
  useEffect(() => () => { visible.current = false; generation.current++; }, [provider, path]);
  function filter(value: string) { setQuery(value); setSelected(0); setScroll(0); if (list.current) list.current.scrollTop = 0; }
  return <>
    <Button ref={trigger} variant="ghost" title={path} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? dismiss() : show()} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
    }}><span className="editor-breadcrumb__name">{label}</span></Button>
    {open && createPortal(<div id={id} ref={popup} role="dialog" aria-label="面包屑目录浏览" className="context-menu is-glass-overlay editor-breadcrumb-popup" onKeyDown={key} onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) dismiss();
    }}>
      <header className="editor-breadcrumb-popup__header"><IconButton label="返回上级目录" disabled={!canBack} onClick={() => void load(parent)}><Icon name="arrowLeft" /></IconButton><span title={directory}>{directory}</span><IconButton label="显示目录隐藏项目" active={hidden} aria-pressed={hidden} onClick={() => { setHidden(value => !value); filter(""); }}><Icon name={hidden ? "eye" : "eyeOff"} /></IconButton><EditorRefreshButton label="刷新当前目录" busy={listing.loading} disabled={disabled} onRefresh={() => void load(directory)} /></header>
      <input ref={search} className="editor-breadcrumb-popup__filter" aria-label="筛选目录项目" value={query} maxLength={256} onChange={event => filter(event.target.value)} placeholder="筛选文件与文件夹" />
      <div role="menu" aria-label="目录内容" aria-busy={listing.loading}>
        {listing.loading ? <p className="editor-breadcrumb-popup__feedback" role="status">正在读取目录…</p> : listing.error ? <div className="editor-breadcrumb-popup__feedback" role="alert">{listing.error}<Button variant="ghost" onClick={() => void load(directory)}>重试</Button></div> : !entries.length ? <p className="editor-breadcrumb-popup__feedback" role="status">{listing.entries.length ? "没有匹配的项目" : "目录为空"}</p> : <div ref={list} className="editor-breadcrumb-popup__list" style={{ height }} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
          <div style={{ height: entries.length * ROW_HEIGHT, position: "relative" }}>{entries.slice(start, end).map((entry, offset) => {
            const index = start + offset;
            return <button type="button" role="menuitem" key={entry.path} data-breadcrumb-index={index} data-path={entry.path} className="context-menu__item editor-breadcrumb-popup__item" style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }} disabled={entry.isDir && entry.isSymlink} tabIndex={selected === index ? 0 : -1} title={entry.path} onFocus={() => setSelected(index)} onClick={() => choose(entry)}>
              <FileEntryIcon name={entry.name} directory={entry.isDir} symlink={entry.isSymlink} /><span>{entry.name}</span>{entry.isDir ? <Icon name="chevron-right" width="14" height="14" /> : null}
            </button>;
          })}</div>
        </div>}
      </div>
      {listing.truncated ? <p className="editor-breadcrumb-popup__feedback" role="status">目录项目过多，仅显示预算内的项目。可进入较小目录继续浏览。</p> : null}
    </div>, document.body)}
  </>;
}
