import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import type { IconName } from "../ui/Icon";
import { Icon } from "../ui/Icon";

export type WorkspaceTabKind = "ssh" | "local" | "sftp";

export interface WorkspaceTabItem {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  /** The user-editable name, without display-only decorations such as the SFTP prefix. */
  renameValue: string;
  active: boolean;
}

interface WorkspaceTabStripProps {
  tabs: WorkspaceTabItem[];
  onSelect: (tab: WorkspaceTabItem) => void;
  onRename: (tab: WorkspaceTabItem, name: string) => void;
  onClose: (tab: WorkspaceTabItem) => void;
  /** Move the whole terminal window (including its panes) or SFTP tab to a native window. */
  onDetach?: (tab: WorkspaceTabItem) => void;
  /** Drop `draggedId` at `targetId`'s position (tab reordering). */
  onReorder?: (draggedId: string, targetId: string) => void;
}

const KIND_ICON: Record<WorkspaceTabKind, IconName> = {
  ssh: "ssh",
  local: "terminalTool",
  sftp: "folder",
};

function TabTitle({ value }: { value: string }) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [scrollDistance, setScrollDistance] = useState(0);

  useLayoutEffect(() => {
    const update = () => {
      const container = containerRef.current;
      const text = textRef.current;
      if (container && text) {
        setScrollDistance(Math.max(0, text.scrollWidth - container.clientWidth));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    if (textRef.current) observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [value]);

  return (
    <span
      className={`tab__title${scrollDistance > 0 ? " is-overflowing" : ""}`}
      ref={containerRef}
      style={{ "--tab-title-scroll-distance": `${scrollDistance}px` } as CSSProperties}
      title={value}
    >
      <span className="tab__title-text" ref={textRef}>{value}</span>
    </span>
  );
}

/**
 * Unified top tab strip: terminal sessions (ssh/local) and SFTP tabs render
 * together, each with a kind icon, title, and close affordance. The active tab
 * gets the 2px accent top border from `.tab.is-active`. Middle-click closes.
 */
export function WorkspaceTabStrip({
  tabs,
  onSelect,
  onRename,
  onClose,
  onDetach,
  onReorder,
}: WorkspaceTabStripProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function beginRename(tab: WorkspaceTabItem) {
    setEditingTabId(tab.id);
    setRenameValue(tab.renameValue);
  }

  function commitRename(tab: WorkspaceTabItem) {
    const name = renameValue.trim();
    if (name && name !== tab.renameValue) {
      onRename(tab, name);
    }
    setEditingTabId(null);
  }

  return (
    <div className="tab-strip" role="tablist" aria-label="工作区标签">
      {tabs.map((tab) => (
        <div
          aria-selected={tab.active}
          className={`tab ${tab.active ? "is-active" : ""} ${
            dropTargetId === tab.id ? "is-drop-target" : ""
          } ${draggedId === tab.id ? "is-dragging" : ""}`
            .replace(/\s+/g, " ")
            .trim()}
          draggable={Boolean(onReorder) && editingTabId !== tab.id}
          key={tab.id}
          onClick={() => {
            if (tab.active) {
              beginRename(tab);
            } else {
              onSelect(tab);
            }
          }}
          onDragStart={(event) => {
            setDraggedId(tab.id);
            event.dataTransfer.effectAllowed = "move";
            // Firefox requires data to be set for the drag to start at all.
            event.dataTransfer.setData("text/plain", tab.id);
          }}
          onDragOver={(event) => {
            if (!draggedId || draggedId === tab.id) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTargetId(tab.id);
          }}
          onDragLeave={() => {
            setDropTargetId((current) => (current === tab.id ? null : current));
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (draggedId && draggedId !== tab.id) {
              onReorder?.(draggedId, tab.id);
            }
            setDraggedId(null);
            setDropTargetId(null);
          }}
          onDragEnd={() => {
            setDraggedId(null);
            setDropTargetId(null);
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(tab);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (tab.active) {
                beginRename(tab);
              } else {
                onSelect(tab);
              }
            }
          }}
          role="tab"
          tabIndex={0}
        >
          <Icon name={KIND_ICON[tab.kind]} height="14" width="14" />
          {editingTabId === tab.id ? (
            <input
              aria-label="标签名称"
              autoFocus
              className="tab__rename"
              onBlur={() => commitRename(tab)}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename(tab);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditingTabId(null);
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              value={renameValue}
            />
          ) : (
            <TabTitle value={tab.title} />
          )}
          <span
            aria-label="关闭"
            className="tab__action tab__close"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClose(tab);
              }
            }}
            role="button"
            tabIndex={0}
            title="关闭"
          >
            <Icon name="close" height="13" width="13" />
          </span>
          {onDetach ? (
            <span
              aria-label="移至新窗口"
              className="tab__action tab__detach"
              onClick={(event) => {
                event.stopPropagation();
                onDetach(tab);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onDetach(tab);
                }
              }}
              role="button"
              tabIndex={0}
              title="移至新窗口"
            >
              <Icon name="externalWindow" height="13" width="13" />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
