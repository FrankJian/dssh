import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IconName } from "../ui/Icon";
import { Icon } from "../ui/Icon";

export type WorkspaceTabKind = "ssh" | "local" | "sftp";

export interface WorkspaceTabItem {
  id: string;
  kind: WorkspaceTabKind;
  icon: IconName;
  title: string;
  /** The user-editable name, without display-only decorations such as the SFTP prefix. */
  renameValue: string;
  active: boolean;
  /** True when one of this terminal tab's panes is executing a command. */
  running?: boolean;
}

interface WorkspaceTabStripProps {
  tabs: WorkspaceTabItem[];
  onSelect: (tab: WorkspaceTabItem) => void;
  onRename: (tab: WorkspaceTabItem, name: string) => void;
  onClose: (tab: WorkspaceTabItem) => void;
  onCloseMany: (tabs: WorkspaceTabItem[]) => void;
  /** Move the whole terminal window (including its panes) or SFTP tab to a native window. */
  onDetach?: (tab: WorkspaceTabItem) => void;
  /** Drop `draggedId` at `targetId`'s position (tab reordering). */
  onReorder?: (draggedId: string, targetId: string) => void;
}

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
 * together, each with its configured icon, title, and close affordance. The active tab
 * gets the 2px accent top border from `.tab.is-active`. Middle-click closes.
 */
export function WorkspaceTabStrip({
  tabs,
  onSelect,
  onRename,
  onClose,
  onCloseMany,
  onDetach,
  onReorder,
}: WorkspaceTabStripProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLDivElement | null>(null);
  const contextTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : undefined;
  const contextTabIndex = contextTab ? tabs.findIndex((tab) => tab.id === contextTab.id) : -1;

  useEffect(() => {
    if (!contextTab) setContextMenu(null);
  }, [contextTab]);

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const menu = menuRef.current;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) dismiss();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        menuTriggerRef.current?.focus();
      } else if (event.key === "Tab") {
        dismiss();
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", keyDown, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [contextMenu]);

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
          aria-label={tab.running ? `${tab.title}，命令正在运行` : tab.title}
          aria-selected={tab.active}
          className={`tab ${tab.active ? "is-active" : ""} ${
            dropTargetId === tab.id ? "is-drop-target" : ""
          } ${draggedId === tab.id ? "is-dragging" : ""}`
            .replace(/\s+/g, " ")
            .trim()}
          draggable={Boolean(onReorder) && editingTabId !== tab.id}
          key={tab.id}
          onClick={() => onSelect(tab)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            menuTriggerRef.current = event.currentTarget;
            const bounds = event.currentTarget.getBoundingClientRect();
            setContextMenu({
              tabId: tab.id,
              x: event.clientX || bounds.left,
              y: event.clientY || bounds.bottom,
            });
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
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              event.stopPropagation();
              menuTriggerRef.current = event.currentTarget;
              const bounds = event.currentTarget.getBoundingClientRect();
              setContextMenu({ tabId: tab.id, x: bounds.left, y: bounds.bottom });
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(tab);
            }
          }}
          role="tab"
          tabIndex={0}
        >
          <span
            className={`tab__kind-icon${tab.running ? " is-running" : ""}`}
            title={tab.running ? "命令正在运行" : undefined}
          >
            <Icon name={tab.icon} />
          </span>
          {editingTabId === tab.id ? (
            <input
              aria-label="标签名称"
              autoFocus
              className="tab__rename"
              onBlur={() => commitRename(tab)}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              onClick={(event) => event.stopPropagation()}
              onFocus={(event) => event.currentTarget.select()}
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
        </div>
      ))}
      {contextMenu && contextTab ? createPortal(
        <div
          aria-label="标签操作"
          className="context-menu is-glass-overlay"
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? (index + 1) % buttons.length
              : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
            if (next !== null) {
              event.preventDefault();
              buttons[next]?.focus();
            }
          }}
          ref={menuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu__item"
            onClick={() => {
              setContextMenu(null);
              onSelect(contextTab);
              beginRename(contextTab);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="edit" height="16" width="16" />
            <span>修改标签名称</span>
          </button>
          {onDetach ? (
            <button
              className="context-menu__item"
              onClick={() => {
                setContextMenu(null);
                onDetach(contextTab);
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="externalWindow" height="16" width="16" />
              <span>拆分为独立窗口</span>
            </button>
          ) : null}
          <div className="context-menu__separator" role="separator" />
          <button
            className="context-menu__item"
            onClick={() => {
              setContextMenu(null);
              onClose(contextTab);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="close" height="16" width="16" />
            <span>关闭标签</span>
          </button>
          <button
            className="context-menu__item"
            disabled={tabs.length === 1}
            onClick={() => {
              setContextMenu(null);
              onCloseMany(tabs.filter((tab) => tab.id !== contextTab.id));
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="close" height="16" width="16" />
            <span>关闭其他标签</span>
          </button>
          <button
            className="context-menu__item"
            disabled={contextTabIndex === 0}
            onClick={() => {
              setContextMenu(null);
              onCloseMany(tabs.slice(0, contextTabIndex));
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="arrowLeft" height="16" width="16" />
            <span>关闭左侧标签</span>
          </button>
          <button
            className="context-menu__item"
            disabled={contextTabIndex === tabs.length - 1}
            onClick={() => {
              setContextMenu(null);
              onCloseMany(tabs.slice(contextTabIndex + 1));
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="arrowRight" height="16" width="16" />
            <span>关闭右侧标签</span>
          </button>
          <div className="context-menu__separator" role="separator" />
          <button
            className="context-menu__item"
            onClick={() => {
              setContextMenu(null);
              onCloseMany([...tabs]);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="close" height="16" width="16" />
            <span>关闭所有标签</span>
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
