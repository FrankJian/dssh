import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui/Icon";
import { handleMenuNavigation } from "../ui/menuNavigation";
import type { EditorMenuItem } from "./EditorActionMenu";

export interface EditorMenuAnchor { x: number; y: number; target: HTMLElement }
export function EditorContextMenu({ anchor, items, onClose }: { anchor: EditorMenuAnchor; items: EditorMenuItem[]; onClose(): void }) {
  const entries = items.filter(item => !item.disabled);
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  function dismiss(restore = false) { close.current(); if (restore && anchor.target.isConnected) anchor.target.focus(); }
  useLayoutEffect(() => {
    const popup = menu.current; if (!popup) return;
    popup.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - popup.offsetHeight - 8))}px`;
    (popup.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? popup).focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) close.current(); };
    const changed = () => close.current();
    const scroll = (event: Event) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) close.current(); };
    document.addEventListener("pointerdown", outside, true); window.addEventListener("resize", changed); window.addEventListener("blur", changed); window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", changed); window.removeEventListener("blur", changed); window.removeEventListener("scroll", scroll, true); };
  }, []);
  useEffect(() => { if (!entries.length) close.current(); }, [entries.length]);
  if (!entries.length) return null;
  return createPortal(<div className="context-menu is-glass-overlay editor-action-menu editor-tree-menu" ref={menu} role="menu" aria-label="文件树操作" tabIndex={-1}
    onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => handleMenuNavigation(event, () => dismiss(true))}>
    {entries.map((item, index) => <div key={item.id} role="presentation">
      {index > 0 && item.section && entries[index - 1]?.section !== item.section ? <div className="editor-menu-separator" role="separator" /> : null}
      <button type="button" role="menuitem" className={`context-menu__item${item.danger ? " is-danger" : ""}`} disabled={item.disabled} onClick={() => { dismiss(true); item.run(); }}>
        {item.icon ? <Icon name={item.icon} width="16" height="16" /> : null}<span>{item.label}</span>
      </button>
    </div>)}
  </div>, document.body);
}
