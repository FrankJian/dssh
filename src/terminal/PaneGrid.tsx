import { Fragment, useRef } from "react";
import type { TerminalSession, TerminalSize } from "../models";
import type { RightClickAction } from "../settings/settings";
import { Icon } from "../ui/Icon";
import type { PaneLayout } from "./usePaneLayout";
import { TerminalView } from "./TerminalView";
import type { TerminalOutputListener } from "./useTerminalSessions";

const MIN_RATIO = 0.12;

interface PaneGridProps {
  layout: PaneLayout;
  focusedPaneId: string | null;
  sessions: TerminalSession[];
  getBacklog: (sessionId: string) => string;
  subscribeOutput: (sessionId: string, listener: TerminalOutputListener) => () => void;
  onPaneData: (sessionId: string, data: string) => void;
  onPaneResize: (sessionId: string, size: TerminalSize) => void;
  onFocusPane: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  onRatios: (ratios: number[]) => void;
  fontSize: number;
  fontFamily: string;
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
  sessions,
  getBacklog,
  subscribeOutput,
  onPaneData,
  onPaneResize,
  onFocusPane,
  onClosePane,
  onRatios,
  fontSize,
  fontFamily,
  copyOnSelect,
  rightClick,
  gpuAcceleration,
  backgroundAlpha,
  hasWallpaper,
  onFontSizeChange,
}: PaneGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  function startDrag(index: number, event: React.MouseEvent) {
    event.preventDefault();
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const rect = grid.getBoundingClientRect();
    const total = layout.dir === "h" ? rect.width : rect.height;
    const startPos = layout.dir === "h" ? event.clientX : event.clientY;
    const startRatios = [...layout.ratios];

    const handleMove = (moveEvent: MouseEvent) => {
      const pos = layout.dir === "h" ? moveEvent.clientX : moveEvent.clientY;
      const deltaFraction = (pos - startPos) / total;
      const a = startRatios[index] + deltaFraction;
      const b = startRatios[index + 1] - deltaFraction;
      if (a < MIN_RATIO || b < MIN_RATIO) {
        return;
      }
      const next = [...startRatios];
      next[index] = a;
      next[index + 1] = b;
      onRatios(next);
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    document.body.style.cursor = layout.dir === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div className="pane-grid" data-dir={layout.dir} ref={gridRef}>
      {layout.sessionIds.map((sessionId, index) => {
        const session = sessions.find((item) => item.id === sessionId);
        const isLast = index === layout.sessionIds.length - 1;
        return (
          <Fragment key={sessionId}>
            <div
              className="pane"
              data-focused={sessionId === focusedPaneId}
              style={{ flexGrow: layout.ratios[index], flexBasis: 0 }}
              onMouseDownCapture={() => onFocusPane(sessionId)}
            >
              <div className="pane__bar">
                <span className="pane__status" data-status={session?.status ?? "disconnected"} />
                <span className="pane__label">{session?.title ?? "终端"}</span>
                <button
                  className="pane__close"
                  onClick={() => onClosePane(sessionId)}
                  title="关闭此分屏"
                  aria-label="关闭此分屏"
                  type="button"
                >
                  <Icon name="close" height="13" width="13" />
                </button>
              </div>
              <div className="pane__body">
                <TerminalView
                  copyOnSelect={copyOnSelect}
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  getBacklog={getBacklog}
                  gpuAcceleration={gpuAcceleration}
                backgroundAlpha={backgroundAlpha}
                hasWallpaper={hasWallpaper}
                  rightClick={rightClick}
                  onData={(data) => onPaneData(sessionId, data)}
                  onFontSizeChange={onFontSizeChange}
                  onResize={(size) => onPaneResize(sessionId, size)}
                  sessionId={sessionId}
                  subscribeOutput={subscribeOutput}
                />
              </div>
            </div>
            {isLast ? null : (
              <div
                className="pane-divider"
                data-dir={layout.dir}
                onMouseDown={(event) => startDrag(index, event)}
                role="separator"
                aria-orientation={layout.dir === "h" ? "vertical" : "horizontal"}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
