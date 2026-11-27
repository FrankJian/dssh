import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";

const WIDTH_KEY = "dssh.editor.sidebarWidth";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 120;
const SNAP_WIDTH = 80;
function storedWidth() {
  try { const width = Number(localStorage.getItem(WIDTH_KEY)); return width >= MIN_WIDTH && width <= 560 ? width : DEFAULT_WIDTH; }
  catch { return DEFAULT_WIDTH; }
}

/** Resize only the Explorer/search surface; document models remain mounted. */
export function EditorSidebar({ children, onCollapse, disabled = false, visible = true }: { children: ReactNode; onCollapse(): void; disabled?: boolean; visible?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [preferred, setPreferred] = useState(storedWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [available, setAvailable] = useState(1000);
  const maximum = Math.max(MIN_WIDTH, Math.min(560, available - 240));
  const expandedWidth = Math.max(MIN_WIDTH, Math.min(maximum, preferred));
  const width = dragWidth === null ? expandedWidth : dragWidth < SNAP_WIDTH ? 0 : Math.min(maximum, dragWidth);
  const current = useRef(expandedWidth); current.current = expandedWidth;
  const permitted = useRef(!disabled && visible); permitted.current = !disabled && visible;
  useEffect(() => {
    const parent = root.current?.parentElement; if (!parent) return;
    const synchronize = (event: StorageEvent) => { if (event.key === WIDTH_KEY) { cleanup.current?.(); setDragWidth(null); setPreferred(storedWidth()); } };
    window.addEventListener("storage", synchronize);
    const observer = new ResizeObserver(() => setAvailable(parent.clientWidth));
    setAvailable(parent.clientWidth); observer.observe(parent);
    return () => { observer.disconnect(); window.removeEventListener("storage", synchronize); cleanup.current?.(); };
  }, []);
  useEffect(() => { cleanup.current?.(); setDragWidth(null); }, [disabled, visible, maximum]);
  function commit(value: number) {
    if (!permitted.current) return;
    if (value < SNAP_WIDTH) { onCollapse(); return; }
    const next = Math.max(MIN_WIDTH, Math.min(maximum, value)); setPreferred(next);
    try { localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* Layout remains usable when preference storage is unavailable. */ }
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !permitted.current) return; event.preventDefault(); cleanup.current?.();
    const handle = event.currentTarget; const origin = event.clientX; const initial = current.current; const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const move = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) setDragWidth(Math.max(0, Math.min(maximum, initial + next.clientX - origin))); };
    const stop = () => {
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", finish, true); window.removeEventListener("pointercancel", cancel, true); handle.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      cleanup.current = null;
    };
    const finish = (next: globalThis.PointerEvent) => { if (next.pointerId !== pointerId) return; stop(); setDragWidth(null); commit(initial + next.clientX - origin); };
    const cancel = () => { stop(); setDragWidth(null); };
    const escape = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); cancel(); } };
    cleanup.current = stop;
    // Snapping moves the sash; observe release before content handlers can consume it.
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", finish, true); window.addEventListener("pointercancel", cancel, true); handle.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape); window.addEventListener("blur", cancel);
  }
  return <div inert={!visible} aria-hidden={!visible} data-sidebar-visible={visible} className={`editor-sidebar-dock sidebar-motion${width === 0 ? " is-snapping" : ""}${dragWidth !== null ? " is-resizing" : ""}`} ref={root} style={{ "--editor-sidebar-width": `${width}px` } as CSSProperties}>
    <div className="editor-sidebar-content sidebar-motion-content" aria-hidden={!visible} inert={!visible || width === 0}>{children}</div>
    <div role="separator" aria-label="调整文件树宽度" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={width === 0 ? "释放以折叠侧栏" : `${Math.round(width)} 像素`} aria-disabled={disabled}
      title="拖动调整宽度，向左拖至边缘折叠；双击恢复默认宽度" className="editor-sidebar-sash" tabIndex={disabled ? -1 : 0} onPointerDown={start} onDoubleClick={() => commit(DEFAULT_WIDTH)}
      onKeyDown={(event) => {
        if (disabled) return;
        const next = event.key === "Home" ? 0 : event.key === "End" ? maximum : event.key === "ArrowLeft" ? expandedWidth <= MIN_WIDTH ? 0 : expandedWidth - (event.shiftKey ? 40 : 10) : event.key === "ArrowRight" ? expandedWidth + (event.shiftKey ? 40 : 10) : null;
        if (next !== null) { event.preventDefault(); event.stopPropagation(); commit(next); }
      }} />
  </div>;
}
