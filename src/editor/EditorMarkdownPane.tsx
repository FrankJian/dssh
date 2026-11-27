import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { FileEntryIcon } from "../sftp/FileEntryIcon";
import { Icon } from "../ui/Icon";
import { EditorMarkdownPreview } from "./EditorPreview";
import { editorBaseName } from "./editorPaths";
import type { MarkdownPreviews } from "./useMarkdownPreviews";

export function EditorMarkdownPane({ previews, children, disabled, enabled, onFocus, onClose }: {
  previews: MarkdownPreviews; children: ReactNode; disabled: boolean; enabled: boolean;
  onFocus(): void; onClose(id: string): void;
}) {
  const paneId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const permitted = useRef(!disabled); permitted.current = !disabled;
  const [ratio, setRatio] = useState(.55);
  const ratioRef = useRef(ratio); ratioRef.current = ratio;
  const selected = previews.tabs.find((tab) => tab.id === previews.activeId);
  const visible = !!selected;
  useEffect(() => { cleanup.current?.(); }, [disabled, visible]);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (visible && !disabled) pane.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }, [previews.focusRequest, disabled, visible]);
  function commit(value: number) { if (permitted.current) setRatio(Math.max(.2, Math.min(.8, value))); }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !permitted.current) return;
    event.preventDefault(); cleanup.current?.();
    const handle = event.currentTarget, initial = ratioRef.current;
    const bounds = root.current!.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    const stop = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", finish); handle.removeEventListener("pointercancel", cancel); handle.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel);
      cleanup.current = null;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    const move = (next: globalThis.PointerEvent) => { if (next.pointerId === event.pointerId) commit((next.clientX - bounds.left) / bounds.width); };
    const finish = (next: globalThis.PointerEvent) => { if (next.pointerId === event.pointerId) stop(); };
    const cancel = () => { stop(); setRatio(initial); };
    const escape = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); cancel(); } };
    cleanup.current = cancel;
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", finish); handle.addEventListener("pointercancel", cancel); handle.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape); window.addEventListener("blur", cancel);
  }
  return <div className="editor-text-and-preview" ref={root}>
    <div className="editor-preview-source" style={{ flex: visible ? ratio : 1 }}>{children}</div>
    {selected ? <>
      <div className="editor-split__divider" role="separator" aria-label="调整 Markdown 预览宽度" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round((1 - ratio) * 100)} aria-valuetext={`预览宽度 ${Math.round((1 - ratio) * 100)}%`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        title="拖动调整预览宽度，双击恢复默认" onPointerDown={start} onDoubleClick={() => commit(.55)} onKeyDown={(event) => {
          if (disabled) return;
          const next = event.key === "Home" ? .8 : event.key === "End" ? .2 : event.key === "ArrowLeft" ? ratio - .02 : event.key === "ArrowRight" ? ratio + .02 : null;
          if (next !== null) { event.preventDefault(); event.stopPropagation(); commit(next); }
        }} />
      <section className="editor-markdown-pane" ref={pane} style={{ flex: 1 - ratio }} aria-label="Markdown 预览分组" onFocusCapture={onFocus}>
        <div className="editor-group__tabs"><div className="editor-file-tabs" role="tablist" aria-label="Markdown 预览标签">
          {previews.tabs.map((tab) => {
            const name = editorBaseName(tab.identity.source, tab.identity.path);
            const duplicate = previews.tabs.some((other) => other.id !== tab.id && editorBaseName(other.identity.source, other.identity.path) === name);
            return <div key={tab.id} className={`editor-file-tab${tab.id === selected.id ? " is-active" : ""}`} role="tab" id={`${paneId}-${tab.id}`} aria-controls={`${paneId}-${tab.id}-panel`} aria-label={`预览 ${duplicate ? tab.identity.path : name}`} aria-selected={tab.id === selected.id} tabIndex={tab.id === selected.id && !disabled ? 0 : -1} aria-disabled={disabled} title={tab.identity.path}
              onClick={() => { if (!disabled) previews.select(tab.id); }} onKeyDown={(event) => {
                if (disabled || event.nativeEvent.isComposing || event.target !== event.currentTarget) return;
                const index = previews.tabs.indexOf(tab), count = previews.tabs.length;
                const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : event.key === "ArrowLeft" ? (index + count - 1) % count : event.key === "ArrowRight" ? (index + 1) % count : ["Enter", " "].includes(event.key) ? index : null;
                if (next !== null) { event.preventDefault(); event.stopPropagation(); previews.select(previews.tabs[next].id); }
              }}>
              <FileEntryIcon name={name} /><span className="editor-file-tab__name">预览 {name}</span>
              <button type="button" aria-label={`关闭预览 ${duplicate ? tab.identity.path : name}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}><Icon name="close" width="14" height="14" /></button>
            </div>;
          })}
        </div></div>
        <div className="editor-preview-path" title={selected.identity.path}><Icon name="eye" width="14" height="14" /><span>{selected.identity.path}</span></div>
        <div className="editor-markdown-content" key={selected.id} role="tabpanel" id={`${paneId}-${selected.id}-panel`} aria-labelledby={`${paneId}-${selected.id}`} aria-label={`预览 ${editorBaseName(selected.identity.source, selected.identity.path)}`} tabIndex={0}>
          {selected.content === null ? <p role="status">Markdown 超过 1 MiB，预览已暂停。</p> : <EditorMarkdownPreview content={selected.content} enabled={enabled} />}
        </div>
      </section>
    </> : null}
  </div>;
}
