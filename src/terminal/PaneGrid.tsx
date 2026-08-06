import { Suspense } from "react";
import type { TerminalSession, TerminalSize } from "../models";
import type { RightClickAction } from "../settings/settings";
import { Icon } from "../ui/Icon";
import { LazyTerminalView } from "./LazyTerminalView";
import { beginPaneDrag, endPaneDrag } from "./paneDrag";
import type { PaneLayout, PaneNode, PaneSplit } from "./usePaneLayout";
import type { TerminalOutputListener } from "./useTerminalSessions";

const MIN_RATIO = 0.12;

interface PaneGridProps {
  layout: PaneLayout;
  focusedPaneId: string | null;
  /** Temporarily render one leaf while preserving the underlying pane tree. */
  zoomedPaneId?: string | null;
  sessions: TerminalSession[];
  getPaneLabel: (sessionId: string) => string;
  getBacklog: (sessionId: string) => string;
  subscribeOutput: (sessionId: string, listener: TerminalOutputListener) => () => void;
  onPaneData: (sessionId: string, data: string) => void;
  onPaneResize: (sessionId: string, size: TerminalSize) => void;
  onFocusPane: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  onRatios: (splitId: string, ratios: [number, number]) => void;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  letterSpacing: number;
  copyOnSelect: boolean;
  rightClick: RightClickAction;
  gpuAcceleration: boolean;
  backgroundAlpha?: number;
  hasWallpaper?: boolean;
  onFontSizeChange: (size: number) => void;
}

export function PaneGrid({
  layout,
  focusedPaneId,
  zoomedPaneId,
  sessions,
  getPaneLabel,
  getBacklog,
  subscribeOutput,
  onPaneData,
  onPaneResize,
  onFocusPane,
  onClosePane,
  onRatios,
  fontSize,
  fontFamily,
  lineHeight,
  letterSpacing,
  copyOnSelect,
  rightClick,
  gpuAcceleration,
  backgroundAlpha,
  hasWallpaper,
  onFontSizeChange,
}: PaneGridProps) {
  function startDrag(split: PaneSplit, event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const grid = event.currentTarget.parentElement;
    if (!grid) {
      return;
    }
    const rect = grid.getBoundingClientRect();
    const total = split.dir === "h" ? rect.width : rect.height;
    const startPos = split.dir === "h" ? event.clientX : event.clientY;
    const startRatios = [...split.ratios] as [number, number];

    // A mouse can report moves far more often than the screen refreshes.
    // Collapse them to one layout update per frame so a drag cannot queue up
    // more work than it can draw.
    let pendingPos: number | null = null;
    let frame: number | null = null;

    const applyPending = () => {
      frame = null;
      if (pendingPos === null) {
        return;
      }
      const deltaFraction = (pendingPos - startPos) / total;
      pendingPos = null;
      const first = startRatios[0] + deltaFraction;
      const second = startRatios[1] - deltaFraction;
      if (first < MIN_RATIO || second < MIN_RATIO) {
        return;
      }
      onRatios(split.id, [first, second]);
    };

    const handleMove = (moveEvent: MouseEvent) => {
      pendingPos = split.dir === "h" ? moveEvent.clientX : moveEvent.clientY;
      if (frame === null) {
        frame = requestAnimationFrame(applyPending);
      }
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      applyPending();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Releases the terminals to fit against their final size.
      endPaneDrag();
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    document.body.style.cursor = split.dir === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    beginPaneDrag();
  }

  function renderNode(node: PaneNode): React.ReactNode {
    if (node.type === "leaf") {
      const session = sessions.find((item) => item.id === node.sessionId);
      return (
        // Keyed by session: without it React reconciles panes by position, so
        // closing or splitting one would hand an existing view a different
        // session and cross-wire the terminals that outlive the change.
        <div
          className="pane"
          data-focused={node.sessionId === focusedPaneId}
          key={node.sessionId}
          onMouseDownCapture={() => onFocusPane(node.sessionId)}
        >
          <div className="pane__bar">
            <span className="pane__status" data-status={session?.status ?? "disconnected"} />
            <span className="pane__label">{getPaneLabel(node.sessionId)}</span>
            <button
              aria-label="关闭此分屏"
              className="pane__close"
              onClick={() => onClosePane(node.sessionId)}
              title="关闭此分屏"
              type="button"
            >
              <Icon name="close" height="13" width="13" />
            </button>
          </div>
          <div className="pane__body">
            <Suspense fallback={<div className="terminal-loading">正在加载终端...</div>}>
              <LazyTerminalView
                autoFocus={node.sessionId === focusedPaneId}
                backgroundAlpha={backgroundAlpha}
                copyOnSelect={copyOnSelect}
                fontFamily={fontFamily}
                fontSize={fontSize}
                letterSpacing={letterSpacing}
                lineHeight={lineHeight}
                getBacklog={getBacklog}
                gpuAcceleration={gpuAcceleration}
                hasWallpaper={hasWallpaper}
                isLocalShell={session?.kind === "local"}
                onData={(data) => onPaneData(node.sessionId, data)}
                onFontSizeChange={onFontSizeChange}
                onResize={(size) => onPaneResize(node.sessionId, size)}
                rightClick={rightClick}
                sessionId={node.sessionId}
                subscribeOutput={subscribeOutput}
              />
            </Suspense>
          </div>
        </div>
      );
    }

    return (
      <div className="pane-grid" data-dir={node.dir} key={node.id}>
        <div className="pane-grid__child" style={{ flexGrow: node.ratios[0], flexBasis: 0 }}>
          {renderNode(node.children[0])}
        </div>
        <div
          aria-orientation={node.dir === "h" ? "vertical" : "horizontal"}
          className="pane-divider"
          data-dir={node.dir}
          onMouseDown={(event) => startDrag(node, event)}
          role="separator"
        />
        <div className="pane-grid__child" style={{ flexGrow: node.ratios[1], flexBasis: 0 }}>
          {renderNode(node.children[1])}
        </div>
      </div>
    );
  }

  function findLeaf(node: PaneNode, sessionId: string): PaneNode | null {
    if (node.type === "leaf") {
      return node.sessionId === sessionId ? node : null;
    }
    return findLeaf(node.children[0], sessionId) ?? findLeaf(node.children[1], sessionId);
  }

  const zoomedLeaf = zoomedPaneId ? findLeaf(layout.root, zoomedPaneId) : null;

  return (
    <section className="pane-workspace" aria-label={zoomedLeaf ? "聚焦终端分屏" : "终端分屏"}>
      {renderNode(zoomedLeaf ?? layout.root)}
    </section>
  );
}
