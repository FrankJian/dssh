import { FileEntryIcon } from "../sftp/FileEntryIcon";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import type { EditorWorkspace } from "../models/editor";
import { startEditorScan, nextEditorScan, cancelEditorScan, filterEditorOpenPaths } from "../services/editorService";
import type { QuickOpenItem } from "./quickOpen";
import QuickOpenWorker from "./quickOpen.worker?worker";
import { DEFAULT_EDITOR_EXCLUDES, type ScanApi } from "./searchRunner";
const defaultApi: ScanApi = { start: startEditorScan, next: nextEditorScan, cancel: cancelEditorScan, filter: filterEditorOpenPaths };
export function EditorQuickOpen({ workspace, api = defaultApi, onOpen, onClose }: { workspace: EditorWorkspace; api?: ScanApi; onOpen(path: string): void; onClose(): void }) {
  const [query, setQuery] = useState(""); const [hidden, setHidden] = useState(false); const [include, setInclude] = useState(""); const [exclude, setExclude] = useState(DEFAULT_EDITOR_EXCLUDES.join("\n"));
  const [count, setCount] = useState(0); const [items, setItems] = useState<QuickOpenItem[]>([]); const [selection, setSelection] = useState(0); const [scanning, setScanning] = useState(true); const [error, setError] = useState<string | null>(null); const [reason, setReason] = useState<string | null>(null);
  const [filters, setFilters] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-quick-index="${selection}"]`)?.scrollIntoView({ block: "nearest" }); }, [selection, items]);
  const files = useRef<QuickOpenItem[]>([]); const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; let operation: string | null = null; let alive = true;
    files.current = []; setCount(0); setItems([]); setError(null); setReason(null); setScanning(true);
    const timeout = setTimeout(() => { void (async () => {
      try {
        const id = await api.start({ workspaceId: workspace.id, content: false, showHidden: hidden, include: include.split("\n").map((s) => s.trim()).filter(Boolean), exclude: exclude.split("\n").map((s) => s.trim()).filter(Boolean), skipPaths: [] }); operation = id;
        while (alive && current === generation.current) {
          const batch = await api.next(workspace.id, id); if (!alive || current !== generation.current) break;
          if (batch.operationId !== id) throw new Error("文件枚举响应不属于此查询。");
          if (batch.items.length > 128 || files.current.length + batch.items.length > 100_000) throw new Error("文件枚举超过预算。");
          files.current.push(...batch.items.map((item) => ({ path: item.path, relativePath: item.relativePath }))); setCount(files.current.length);
          if (batch.progress.done) { operation = null; setReason(batch.progress.reason ? `列表已截断：${batch.progress.reason}` : batch.progress.unreadable ? `${batch.progress.unreadable} 个目录无法读取` : null); break; }
        }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "无法枚举文件。"); }
      finally { if (operation) await api.cancel(workspace.id, operation).catch(() => {}); if (alive) setScanning(false); }
    })(); }, 200);
    return () => { alive = false; clearTimeout(timeout); if (operation) void api.cancel(workspace.id, operation).catch(() => {}); };
  }, [workspace, api, hidden, include, exclude]);
  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null; let timeout: ReturnType<typeof setTimeout> | undefined;
    const delay = setTimeout(() => {
      worker = new QuickOpenWorker();
      timeout = setTimeout(() => { worker?.terminate(); setError("文件名查询超过 1 秒，已停止。请缩短查询或调整范围。"); }, 1000);
      worker.onmessage = ({ data }: MessageEvent<{ items?: QuickOpenItem[]; error?: string }>) => { if (!alive) return; clearTimeout(timeout); worker?.terminate(); if (data.items) { setItems(data.items); setSelection(0); } else setError(data.error ?? "文件名查询失败。"); };
      worker.onerror = () => { clearTimeout(timeout); worker?.terminate(); setError("快捷打开 worker 无法运行。"); };
      worker.postMessage({ items: files.current, query });
    }, 60);
    return () => { alive = false; clearTimeout(delay); clearTimeout(timeout); worker?.terminate(); };
  }, [query, count]);
  function open(item: QuickOpenItem | undefined) { if (item) { onClose(); onOpen(item.path); } }
  return <Dialog className="editor-quick-dialog" title="快捷打开" onClose={onClose} initialFocusSelector="[data-editor-quick-query]" footer={<div className="editor-quick-open__footer"><span>↑↓ 选择 · Enter 打开</span><Button aria-label="取消" variant="ghost" onClick={onClose}><kbd>Esc</kbd> 关闭</Button></div>}>
    <div className="editor-quick-open">
      <div className="editor-quick-open__query"><Icon name="search" width="18" height="18" /><input placeholder="搜索文件名或相对路径…" aria-label="搜索文件名或相对路径" aria-controls="editor-quick-results" aria-activedescendant={items[selection] ? `editor-quick-item-${selection}` : undefined} data-editor-quick-query value={query} maxLength={256} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelection(current => items.length ? (current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0); }
        else if (event.key === "Enter") { event.preventDefault(); open(items[selection]); }
      }} /></div>
      <div className="editor-quick-open__tools"><span role="status">{scanning ? "正在搜索文件…" : `${count} 个文件`}{items.length === 100 ? " · 前 100 项" : ""}</span><span className="editor-quick-open__toggles"><IconButton label="快捷打开包含隐藏文件" active={hidden} aria-pressed={hidden} onClick={() => setHidden(v => !v)}><Icon name={hidden ? "eye" : "eyeOff"} /></IconButton><IconButton label="筛选搜索范围" active={filters} aria-expanded={filters} onClick={() => setFilters(v => !v)}><Icon name="selection" /></IconButton></span></div>
      {filters ? <div className="editor-quick-open__filters"><label>包含 glob<textarea aria-label="快捷打开包含 glob" rows={2} value={include} onChange={event => setInclude(event.target.value)} /></label><label>排除 glob<textarea aria-label="快捷打开排除 glob" rows={2} value={exclude} onChange={event => setExclude(event.target.value)} /></label></div> : null}
      {error ? <p role="alert">{error}</p> : null}{reason ? <p role="status">{reason}</p> : null}
      <div ref={list} id="editor-quick-results" className="editor-quick-open__list" role="listbox" aria-label="快捷打开文件" aria-activedescendant={items[selection] ? `editor-quick-item-${selection}` : undefined}>
        {items.map((item, index) => {
          const parts = item.relativePath.split(/[\\/]/), name = parts.pop() ?? item.relativePath;
          return <button key={item.path} data-quick-index={index} id={`editor-quick-item-${index}`} role="option" aria-label={item.relativePath} aria-selected={index === selection} type="button" className={index === selection ? "is-selected" : ""} onMouseEnter={() => setSelection(index)} onClick={() => open(item)} title={item.path}>
            <FileEntryIcon name={name} /><span className="editor-quick-open__result"><strong>{name}</strong>{parts.length ? <span>{parts.join(" / ")}</span> : null}</span>{index === selection ? <kbd aria-hidden="true">↵</kbd> : null}
          </button>;
        })}
        {!scanning && !items.length ? <p className="editor-quick-open__empty">没有匹配文件</p> : null}
      </div>
    </div>
  </Dialog>;
}
