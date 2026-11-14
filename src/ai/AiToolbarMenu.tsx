import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AssistantDockPosition } from "../app/assistantDock";
import { Icon, type IconName } from "../ui/Icon";

const POSITIONS: { value: AssistantDockPosition; label: string; icon: IconName }[] = [
  { value: "left", label: "停靠在左侧", icon: "panelLeft" },
  { value: "bottom", label: "停靠在底部", icon: "panelBottom" },
  { value: "right", label: "停靠在右侧", icon: "panelRight" },
];

interface AiToolbarMenuProps {
  position: AssistantDockPosition;
  onPositionChange?: (position: AssistantDockPosition) => void;
  onOpenConfig: () => void;
  onRename: () => void;
  renameDisabled: boolean;
  onClear: () => void;
  onDelete: () => void;
  sessionActionsDisabled: boolean;
}

export function AiToolbarMenu({
  position, onPositionChange, onOpenConfig, onRename, renameDisabled, onClear, onDelete, sessionActionsDisabled,
}: AiToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function dismissOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function run(action: () => void) {
    close();
    action();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % buttons.length; break;
      case "ArrowUp": next = (index + buttons.length - 1) % buttons.length; break;
      case "Home": next = 0; break;
      case "End": next = buttons.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  }

  return (
    <div className="ai-toolbar-menu" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button type="button" ref={trigger} aria-label="更多助手操作" title="更多助手操作"
        className={`icon-button${open ? " is-active" : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}>
        <Icon name="ellipsis" height="16" width="16" />
      </button>
      {open ? (
        <div className="ai-toolbar-menu__popover is-glass-overlay" id={menuId}
          aria-label="助手操作" role="menu" onKeyDown={handleMenuKeyDown}>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => run(onOpenConfig)}>
            <Icon name="settings" height="16" width="16" />
            <span>模型配置</span>
          </button>
          {onPositionChange ? (
            <>
              <div className="ai-toolbar-menu__separator" role="separator" />
              {POSITIONS.map(({ value, icon, label }) => (
                <button type="button" key={value} role="menuitemradio" tabIndex={-1}
                  aria-checked={position === value} onClick={() => run(() => onPositionChange(value))}>
                  <Icon name={icon} height="16" width="16" />
                  <span>{label}</span>
                  {position === value ? <Icon name="check" height="16" width="16" /> : null}
                </button>
              ))}
            </>
          ) : null}
          <div className="ai-toolbar-menu__separator" role="separator" />
          <button type="button" role="menuitem" tabIndex={-1} disabled={renameDisabled}
            onClick={() => run(onRename)}>
            <Icon name="edit" height="16" width="16" />
            <span>重命名会话</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} disabled={sessionActionsDisabled}
            onClick={() => run(onClear)}>
            <Icon name="refresh" height="16" width="16" />
            <span>清空当前会话</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} disabled={sessionActionsDisabled}
            className="ai-toolbar-menu__danger" onClick={() => run(onDelete)}>
            <Icon name="trash" height="16" width="16" />
            <span>删除当前会话</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
