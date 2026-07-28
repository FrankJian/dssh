import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../ui/Icon";

interface TerminalFileLayoutProps {
  fileTree: ReactNode;
  terminal: ReactNode;
}

const DEFAULT_TREE_WIDTH = 300;
const MIN_TREE_WIDTH = 220;
const MAX_TREE_WIDTH = 560;
const HIDE_SNAP_WIDTH = 128;

function clampWidth(width: number): number {
  return Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, Math.round(width)));
}

/**
 * A terminal-specific split with a collapsible remote file tree. Unlike the
 * terminal pane grid this does not create another shell; it only gives the
 * active shell a companion navigator.
 */
export function TerminalFileLayout({ fileTree, terminal }: TerminalFileLayoutProps) {
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [treeHidden, setTreeHidden] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function startResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: treeWidth };

    const handleMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const nextWidth = drag.startWidth + moveEvent.clientX - drag.startX;
      if (nextWidth <= HIDE_SNAP_WIDTH) {
        setTreeHidden(true);
        return;
      }
      setTreeHidden(false);
      setTreeWidth(clampWidth(nextWidth));
    };
    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <section className="terminal-file-layout" aria-label="终端与文件列表">
      <div
        className={`terminal-file-layout__tree${treeHidden ? " is-hidden" : ""}`}
        style={{ width: `${treeWidth}px` }}
      >
        {fileTree}
      </div>
      {treeHidden ? (
        <button
          aria-label="显示文件列表"
          className="terminal-file-layout__reveal"
          onClick={() => setTreeHidden(false)}
          title="显示文件列表"
          type="button"
        >
          <Icon name="folder" height="16" width="16" />
        </button>
      ) : (
        <div
          aria-label="调整文件列表宽度"
          aria-orientation="vertical"
          className="terminal-file-layout__divider"
          onMouseDown={startResize}
          role="separator"
        />
      )}
      <div className="terminal-file-layout__terminal">{terminal}</div>
    </section>
  );
}
