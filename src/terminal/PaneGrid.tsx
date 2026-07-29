import type { TerminalSession, TerminalSize } from "../models";
import type { RightClickAction } from "../settings/settings";
import { Icon } from "../ui/Icon";
import type { PaneLayout, PaneNode, PaneSplit } from "./usePaneLayout";
import { TerminalView } from "./TerminalView";
import type { TerminalOutputListener } from "./useTerminalSessions";

const MIN_RATIO = 0.12;

interface PaneGridProps {
  layout: PaneLayout;
  focusedPaneId: string | null;
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

    const handleMove = (moveEvent: MouseEvent) => {
      const pos = split.dir === "h" ? moveEvent.clientX : moveEvent.clientY;
      const deltaFraction = (pos - startPos) / total;
      const first = startRatios[0] + deltaFraction;
      const second = startRatios[1] - deltaFraction;
      if (first < MIN_RATIO || second < MIN_RATIO) {
        return;
      }
      onRatios(split.id, [first, second]);
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    document.body.style.cursor = split.dir === "h" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }

  function renderNode(node: PaneNode): React.ReactNode {
    if (node.type === "leaf") {
      const session = sessions.find((item) => item.id === node.sessionId);
      return (
        <div
          className="pane"
          data-focused={node.sessionId === focusedPaneId}
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
            <TerminalView
              backgroundAlpha={backgroundAlpha}
              copyOnSelect={copyOnSelect}
              fontFamily={fontFamily}
              fontSize={fontSize}
              getBacklog={getBacklog}
              gpuAcceleration={gpuAcceleration}
              hasWallpaper={hasWallpaper}
              onData={(data) => onPaneData(node.sessionId, data)}
              onFontSizeChange={onFontSizeChange}
              onResize={(size) => onPaneResize(node.sessionId, size)}
              rightClick={rightClick}
              sessionId={node.sessionId}
              subscribeOutput={subscribeOutput}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="pane-grid" data-dir={node.dir}>
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

  return (
    <section className="pane-workspace" aria-label="终端分屏">
      {renderNode(layout.root)}
    </section>
  );
}
