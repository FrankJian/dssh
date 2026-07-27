import { useState } from "react";
import type { IconName } from "../ui/Icon";
import { Icon } from "../ui/Icon";

export type WorkspaceTabKind = "ssh" | "local" | "sftp";

export interface WorkspaceTabItem {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  active: boolean;
}

interface WorkspaceTabStripProps {
  tabs: WorkspaceTabItem[];
  onSelect: (tab: WorkspaceTabItem) => void;
  onClose: (tab: WorkspaceTabItem) => void;
  /** Drop `draggedId` at `targetId`'s position (tab reordering). */
  onReorder?: (draggedId: string, targetId: string) => void;
}

const KIND_ICON: Record<WorkspaceTabKind, IconName> = {
  ssh: "ssh",
  local: "terminalTool",
  sftp: "folder",
};

/**
 * Unified top tab strip: terminal sessions (ssh/local) and SFTP tabs render
 * together, each with a kind icon, title, and close affordance. The active tab
 * gets the 2px accent top border from `.tab.is-active`. Middle-click closes.
 */
export function WorkspaceTabStrip({
  tabs,
  onSelect,
  onClose,
  onReorder,
}: WorkspaceTabStripProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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
          draggable={Boolean(onReorder)}
          key={tab.id}
          onClick={() => onSelect(tab)}
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
              onSelect(tab);
            }
          }}
          role="tab"
          tabIndex={0}
        >
          <Icon name={KIND_ICON[tab.kind]} height="14" width="14" />
          <span className="tab__title">{tab.title}</span>
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
        </div>
      ))}
    </div>
  );
}
