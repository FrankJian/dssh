import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { boundedSize, fitWorkspaceDocks, workspaceDockGrid, type AssistantDockPosition } from "./assistantDock";
import { beginPaneDrag, endPaneDrag } from "../terminal/paneDrag";

const DOCK_TRANSITION_MS = 150;

interface AppLayoutProps {
  titleBar: ReactNode;
  activityBar: ReactNode | null;
  sidebar: ReactNode | null;
  main: ReactNode;
  /** Shared auxiliary dock: AI can move; host tools stay on the right. */
  rightPanel?: ReactNode | null;
  panelPosition?: AssistantDockPosition;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  rightPanelWidth: number;
  onRightPanelWidthChange: (width: number) => void;
  panelHeight?: number;
  onPanelHeightChange?: (height: number) => void;
}

export function AppLayout({ titleBar, activityBar, sidebar, main, rightPanel,
  panelPosition = "right", sidebarWidth, onSidebarWidthChange, rightPanelWidth,
  onRightPanelWidthChange, panelHeight = 320, onPanelHeightChange,
}: AppLayoutProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const cleanupDrag = useRef<(() => void) | null>(null);
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight - 32, rail: 48 }));
  const panelOpen = Boolean(rightPanel);
  const bottom = panelPosition === "bottom";

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      setSize({ width: body.clientWidth, height: body.clientHeight, rail: railRef.current?.offsetWidth ?? 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    if (railRef.current) observer.observe(railRef.current);
    return () => observer.disconnect();
  }, [Boolean(activityBar)]);
  useEffect(() => () => { cleanupDrag.current?.(); }, [panelPosition, panelOpen]);

  const fitted = fitWorkspaceDocks({ width: size.width, height: size.height, railWidth: activityBar ? size.rail : 0,
    sidebarWidth, panelWidth: rightPanelWidth, panelHeight, sidebar: Boolean(sidebar), panel: panelOpen, position: panelPosition });
  const sidebarOpen = fitted.showSidebar;
  const lastOpenSidebarWidth = useRef(fitted.sidebarWidth);
  useLayoutEffect(() => {
    if (sidebarOpen) lastOpenSidebarWidth.current = fitted.sidebarWidth;
  }, [sidebarOpen, fitted.sidebarWidth]);
  const sidebarTrackWidth = sidebarOpen ? fitted.sidebarWidth : lastOpenSidebarWidth.current;
  const panelSize = bottom ? fitted.panelHeight : fitted.panelWidth;
  const lastOpenPanel = useRef({ position: panelPosition, size: panelSize });
  useLayoutEffect(() => {
    if (panelOpen) lastOpenPanel.current = { position: panelPosition, size: panelSize };
  }, [panelOpen, panelPosition, panelSize]);
  const panelTrack = panelOpen ? { position: panelPosition, size: panelSize } : lastOpenPanel.current;
  const previousDocks = useRef({ sidebarOpen, panelOpen });
  const hasActivityBar = Boolean(activityBar);
  useLayoutEffect(() => {
    const previous = previousDocks.current;
    const changed = previous.sidebarOpen !== sidebarOpen || previous.panelOpen !== panelOpen;
    previousDocks.current = { sidebarOpen, panelOpen };
    if (!changed || !hasActivityBar) return;
    // Fit the terminal once the docks stop moving so intermediate sizes
    // do not reflow the terminal buffer or resize the remote PTY.
    beginPaneDrag();
    let pending = true;
    const finish = () => {
      if (!pending) return;
      pending = false;
      endPaneDrag();
    };
    const timer = window.setTimeout(finish, DOCK_TRANSITION_MS + 34);
    return () => {
      window.clearTimeout(timer);
      finish();
    };
  }, [hasActivityBar, sidebarOpen, panelOpen]);
  const resize = (axis: "x" | "y", current: number, set: (value: number) => void, sign: 1 | -1, min: number, max: number) => ({
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      cleanupDrag.current?.();
      event.currentTarget.focus();
      const start = axis === "x" ? event.clientX : event.clientY;
      const oldCursor = document.body.style.cursor;
      const oldSelect = document.body.style.userSelect;
      const move = (next: globalThis.PointerEvent) => {
        const delta = ((axis === "x" ? next.clientX : next.clientY) - start) * sign;
        set(boundedSize(current + delta, min, max));
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("blur", stop);
        window.removeEventListener("keydown", escape);
        document.body.style.cursor = oldCursor;
        document.body.style.userSelect = oldSelect;
        cleanupDrag.current = null;
      };
      const escape = (key: globalThis.KeyboardEvent) => { if (key.key === "Escape") stop(); };
      cleanupDrag.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("blur", stop);
      window.addEventListener("keydown", escape);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
      const increase = axis === "x" ? "ArrowRight" : "ArrowDown";
      if (![decrease, increase, "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      set(event.key === "Home" ? min : event.key === "End" ? max
        : boundedSize(current + (event.key === increase ? 1 : -1) * sign * (event.shiftKey ? 40 : 16), min, max));
    },
  });

  const grid = workspaceDockGrid({ rail: Boolean(activityBar), sidebar: Boolean(sidebar), panel: panelOpen,
    position: panelTrack.position, sizes: fitted, animateSidebar: hasActivityBar, animatePanel: hasActivityBar });
  const panelMin = bottom ? Math.min(220, fitted.panelHeightMax) : Math.min(280, fitted.panelMax);
  const panelMax = bottom ? fitted.panelHeightMax : fitted.panelMax;
  const setPanelSize = bottom ? onPanelHeightChange ?? (() => {}) : onRightPanelWidthChange;

  return <div className="app-shell" style={{
    "--workspace-rail-width": `${activityBar ? size.rail : 0}px`,
    "--workspace-sidebar-width": `${sidebarTrackWidth}px`,
    "--workspace-dock-duration": `${DOCK_TRANSITION_MS}ms`,
    "--workspace-sidebar-progress": sidebarOpen ? 1 : 0,
    "--workspace-panel-size": `${panelTrack.size}px`,
    "--workspace-panel-progress": panelOpen ? 1 : 0,
  } as CSSProperties}>
    {titleBar}
    <div className={`app-body app-body--dock-${panelTrack.position}`} ref={bodyRef} style={{
      display: "grid", ...grid,
    }}>
      {activityBar ? <div className="activity-rail" ref={railRef} style={{ gridArea: "rail" }}>{activityBar}</div> : null}
      {activityBar || sidebarOpen ? (
        <aside className="side-dock" inert={!sidebarOpen} style={{ gridArea: "sidebar" }}>
          {sidebar ? <div className="side-dock__content">{sidebar}</div> : null}
        </aside>
      ) : null}
      {sidebar ? <div className="pane-resizer" style={{ gridArea: "sidebar-resizer", display: fitted.showSidebar ? undefined : "none" }}
        {...resize("x", fitted.sidebarWidth, onSidebarWidthChange, 1, Math.min(220, fitted.sidebarMax), fitted.sidebarMax)}
        role="separator" tabIndex={fitted.showSidebar ? 0 : -1} aria-orientation="vertical" aria-label="调整侧栏宽度"
        aria-valuemin={Math.min(220, fitted.sidebarMax)} aria-valuemax={fitted.sidebarMax} aria-valuenow={fitted.sidebarWidth}
        title="拖动调整侧栏宽度；方向键微调，双击恢复默认" onDoubleClick={() => onSidebarWidthChange(288)} /> : null}
      <div className="main-column" style={{ gridArea: "main" }}>
        <div className="main-column__content">{main}</div>
      </div>
      {panelOpen ? <div className={`pane-resizer${bottom ? " pane-resizer--horizontal" : ""}`} style={{ gridArea: "dock-resizer" }}
        {...resize(bottom ? "y" : "x", panelSize, setPanelSize, panelPosition === "left" ? 1 : -1, panelMin, panelMax)}
        role="separator" tabIndex={0} aria-orientation={bottom ? "horizontal" : "vertical"} aria-label={bottom ? "调整面板高度" : "调整面板宽度"}
        aria-valuemin={panelMin} aria-valuemax={panelMax} aria-valuenow={panelSize}
        title="拖动调整面板大小；方向键微调，双击恢复默认" onDoubleClick={() => setPanelSize(bottom ? 320 : 360)} /> : null}
      {hasActivityBar || panelOpen ? (
        <aside className={`right-dock workspace-dock workspace-dock--${panelTrack.position} is-glass-chrome`} inert={!panelOpen} style={{ gridArea: "dock" }}>
          {rightPanel}
        </aside>
      ) : null}
    </div>
  </div>;
}
