import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AssistantDockPosition } from "../app/assistantDock";
import { Icon, type IconName } from "../ui/Icon";

const POSITIONS: { value: AssistantDockPosition; label: string; icon: IconName }[] = [
  { value: "left", label: "停靠在左侧", icon: "panelLeft" },
  { value: "bottom", label: "停靠在底部", icon: "panelBottom" },
  { value: "right", label: "停靠在右侧", icon: "panelRight" },
];

export function AiDockMenu({ position, onChange }: {
  position: AssistantDockPosition;
  onChange: (position: AssistantDockPosition) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = POSITIONS.find((item) => item.value === position)!;

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(); return; }
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation(); buttons[next]?.focus();
  }

  return <div className="ai-dock-menu" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" className={`icon-button${open ? " is-active" : ""}`} ref={trigger}
      aria-label="AI 助手停靠位置" title={`切换布局 · ${current.label}`} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? menuId : undefined} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        else if (event.key === "Escape") { event.stopPropagation(); close(); }
      }}>
      <Icon name={current.icon} height="16" width="16" />
    </button>
    {open ? <div className="ai-dock-menu__popover is-glass-overlay" role="menu" id={menuId}
      aria-label="选择助手停靠位置" onKeyDown={menuKeyDown}>
      {POSITIONS.map((item) => <button type="button" key={item.value} role="menuitemradio"
        className={`icon-button${position === item.value ? " is-active" : ""}`}
        aria-label={item.label} title={item.label} aria-checked={position === item.value}
        tabIndex={position === item.value ? 0 : -1} onClick={() => { close(); onChange(item.value); }}>
        <Icon name={item.icon} height="16" width="16" />
      </button>)}
    </div> : null}
  </div>;
}
