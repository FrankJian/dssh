import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { beginPaneDrag, endPaneDrag } from "./paneDrag";
import { Icon } from "../ui/Icon";

interface TerminalFileLayoutProps {
  fileTree: ReactNode;
  terminal: ReactNode;
  sidebarVisible?: boolean;
  onSidebarVisibleChange?: (visible: boolean) => void;
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
export function TerminalFileLayout({ fileTree, terminal, sidebarVisible, onSidebarVisibleChange }: TerminalFileLayoutProps) {
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
  const [localHidden, setLocalHidden] = useState(false);
  const treeHidden = sidebarVisible === undefined ? localHidden : !sidebarVisible;
  const setTreeHidden = (hidden: boolean) => {
    if (onSidebarVisibleChange) onSidebarVisibleChange(!hidden); else setLocalHidden(hidden);
  };
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const cleanupDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupDrag.current?.(), [treeHidden]);
  const previousHidden = useRef(treeHidden);
  useEffect(() => {
    if (previousHidden.current === treeHidden) return;
    previousHidden.current = treeHidden;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    beginPaneDrag();
    let pending = true;
    const finish = () => { if (pending) { pending = false; endPaneDrag(); } };
    const timer = window.setTimeout(finish, 184);
    return () => { window.clearTimeout(timer); finish(); };
  }, [treeHidden]);

  function startResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    cleanupDrag.current?.();
    dragRef.current = { startX: event.clientX, startWidth: treeWidth };
    const oldCursor = document.body.style.cursor;
    const oldSelect = document.body.style.userSelect;

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
      window.removeEventListener("blur", handleUp);
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldSelect;
      cleanupDrag.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    cleanupDrag.current = handleUp;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <section className="terminal-file-layout sidebar-motion" data-sidebar-visible={!treeHidden} aria-label="终端与文件列表">
      <div
        className={`terminal-file-layout__tree${treeHidden ? " is-hidden" : ""}`}
        inert={treeHidden}
        aria-hidden={treeHidden}
        style={{ "--terminal-file-tree-width": `${treeWidth}px` } as CSSProperties}
      >
        <div className="terminal-file-layout__tree-content sidebar-motion-content" aria-hidden={treeHidden}>{fileTree}</div>
      </div>
      {treeHidden && sidebarVisible !== undefined ? null : treeHidden ? (
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
