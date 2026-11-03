import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import type { ConnectionFolderNode } from "./connectionFolders";

interface Props { nodes: ConnectionFolderNode[]; selectedPath: string | null; onSelect: (path: string) => void; onContextMenu: (path: string, x: number, y: number, trigger: HTMLButtonElement) => void }
export function ConnectionFolderTree({ nodes, selectedPath, onSelect, onContextMenu }: Props) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const pendingSelectionScroll = useRef(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!selectedPath) return;
    pendingSelectionScroll.current = true;
    setCollapsed((current) => {
      const next = new Set([...current].filter((path) => !selectedPath.startsWith(`${path}/`)));
      return next.size === current.size ? current : next;
    });
  }, [selectedPath]);
  useEffect(() => {
    if (pendingSelectionScroll.current && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest" });
      pendingSelectionScroll.current = false;
    }
  }, [selectedPath, collapsed]);
  function toggleFolder(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function renderNodes(items: ConnectionFolderNode[]) {
    return items.map((node) => {
      const expanded = !collapsed.has(node.path);
      return <li key={node.path}>
        <div className="connection-folder-tree__row" data-expandable={node.children.length > 0}>
          <button className={`session-manager__nav-item${selectedPath === node.path ? " is-active" : ""}`}
            ref={selectedPath === node.path ? selectedRef : undefined}
            type="button" title={node.path} aria-current={selectedPath === node.path ? "page" : undefined}
            aria-expanded={node.children.length > 0 ? expanded : undefined}
            aria-haspopup="menu"
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(node.path, event.clientX, event.clientY, event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onContextMenu(node.path, rect.left, rect.bottom, event.currentTarget);
              }
            }}
            onDoubleClick={() => { if (node.children.length > 0) toggleFolder(node.path); }}
            onClick={() => onSelect(node.path)}>
            <Icon name="folder" width="16" height="16" />
            <span className="session-manager__nav-label">{node.name}</span>
            <span className="session-manager__nav-count">{node.count}</span>
          </button>
          {node.children.length > 0 ? <button className="connection-folder-tree__toggle" type="button"
            aria-label={`${expanded ? "折叠" : "展开"}目录 ${node.path}`} aria-expanded={expanded}
            onClick={() => toggleFolder(node.path)}>
            <Icon name={expanded ? "chevron-down" : "chevron-right"} width="12" height="12" />
          </button> : null}
        </div>
        {node.children.length > 0 && expanded ? <ul>{renderNodes(node.children)}</ul> : null}
      </li>;
    });
  }
  return <ul className="connection-folder-tree" aria-label="连接目录">{renderNodes(nodes)}</ul>;
}
