import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import type { IconName } from "../ui/Icon";
import { Icon } from "../ui/Icon";
import { handleMenuNavigation } from "../ui/menuNavigation";
export interface EditorMenuItem { id: string; label: string; disabled?: boolean; danger?: boolean; section?: string; icon?: IconName; run(): void }
export function EditorActionMenu({ label, items, disabled, icon, triggerRef }: { label: string; items(): EditorMenuItem[]; disabled?: boolean; icon?: IconName; triggerRef?: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false); const ownTrigger = useRef<HTMLButtonElement>(null); const trigger = triggerRef ?? ownTrigger; const menu = useRef<HTMLDivElement>(null); const id = useId();
  const entries = open ? items() : [];
  const currentItems = useRef(items); currentItems.current = items;
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    // Language providers load asynchronously after changing a model's language.
    // Refresh only changed menu capabilities while the menu is visible.
    const signature = () => JSON.stringify(currentItems.current().map(({ id, label, disabled }) => [id, label, !!disabled]));
    let previous = signature();
    const timer = setInterval(() => { const next = signature(); if (next !== previous) { previous = next; refresh((value) => value + 1); } }, 200);
    return () => clearInterval(timer);
  }, [open]);
  function dismiss(restore = false) { setOpen(false); if (restore) trigger.current?.focus(); }
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const bounds = trigger.current.getBoundingClientRect(); const popup = menu.current;
    popup.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - popup.offsetHeight - 8))}px`;
    (popup.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? popup).focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) dismiss(); };
    const close = () => dismiss();
    document.addEventListener("pointerdown", outside, true); window.addEventListener("resize", close); window.addEventListener("blur", close);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", close); window.removeEventListener("blur", close); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const triggerProps = { ref: trigger, disabled, "aria-haspopup": "menu" as const, "aria-expanded": open, "aria-controls": open ? id : undefined,
    onClick: () => setOpen((value) => !value), onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } } };
  return <>{icon ? <IconButton label={label} {...triggerProps}><Icon name={icon} /></IconButton> : <Button variant="ghost" {...triggerProps}>{label}<Icon name="chevron-down" width="12" height="12" /></Button>}
    {open && createPortal(<div id={id} className="context-menu is-glass-overlay editor-action-menu" role="menu" tabIndex={-1} aria-label={label} ref={menu} onKeyDown={(event) => handleMenuNavigation(event, () => dismiss(true))}>
      {entries.map((item, index) => <div key={item.id} role="presentation">{item.section && entries[index - 1]?.section !== item.section ? <div className="editor-action-menu__section" role="presentation">{item.section}</div> : null}<button key={item.id} type="button" role="menuitem" className={`context-menu__item${item.danger ? " is-danger" : ""}`} disabled={item.disabled} onClick={() => { dismiss(true); item.run(); }}>{item.label}</button></div>)}
    </div>, document.body)}</>;
}
