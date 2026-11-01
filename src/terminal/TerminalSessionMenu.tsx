import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalSession } from "../models";
import { Icon, type IconName } from "../ui/Icon";

interface TerminalSessionMenuProps {
  session: TerminalSession;
  onReconnect: () => void;
  onCancelReconnect: () => void;
  onOpenHostTools?: () => void;
  onOpenPortForward?: () => void;
}

/** Session actions shared by the main and detached window title bars. */
export function TerminalSessionMenu({ session, onReconnect, onCancelReconnect,
  onOpenHostTools, onOpenPortForward }: TerminalSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reconnecting = session.status === "reconnecting";
  const items: { label: string; icon: IconName; run: () => void }[] = [];
  if (onOpenHostTools) items.push({ label: "主机工具", icon: "server", run: onOpenHostTools });
  items.push(reconnecting
    ? { label: "取消重连", icon: "stop", run: onCancelReconnect }
    : { label: "重新连接", icon: "refresh", run: onReconnect });
  if (onOpenPortForward) items.push({ label: "端口转发", icon: "forward", run: onOpenPortForward });

  useEffect(() => { setOpen(false); }, [session.id]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    menu.style.left = `${Math.max(8, Math.min(trigger.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${trigger.bottom + 4}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)
        && !triggerRef.current?.contains(event.target)) dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  return <>
    <button
      aria-controls={open ? menuId : undefined}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={reconnecting ? "会话工具，正在重连" : "会话工具"}
      className={`tab-action${open ? " is-active" : ""}`}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
        }
      }}
      ref={triggerRef}
      title={reconnecting ? "会话工具 · 正在重连" : "会话工具"}
      type="button"
    >
      <Icon name="toolbox" height="16" width="16" />
    </button>
    {open ? createPortal(
      <div
        aria-label="会话工具"
        className="context-menu is-glass-overlay"
        id={menuId}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
            return;
          }
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (index + 1) % buttons.length
            : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
            : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
          if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
        }}
        ref={menuRef}
        role="menu"
      >
        {items.map((item) => <button
          className="context-menu__item"
          key={item.label}
          onClick={() => { setOpen(false); triggerRef.current?.focus(); item.run(); }}
          role="menuitem"
          type="button"
        >
          <Icon name={item.icon} height="16" width="16" />
          <span>{item.label}</span>
        </button>)}
      </div>, document.body,
    ) : null}
  </>;
}
