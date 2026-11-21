import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

interface DialogProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  initialFocusSelector?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Native modal isolation also works while every action is temporarily disabled. */
export function Dialog({ title, onClose, busy = false, initialFocusSelector, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = previousFocus.current;
    dialog.showModal();
    if (initialFocusSelector) dialog.querySelector<HTMLElement>(initialFocusSelector)?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={ref} className="profile-editor app-dialog is-glass-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}>
      <header className="profile-editor__topbar">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="关闭" disabled={busy} onClick={onClose}><Icon name="close" /></IconButton>
      </header>
      <div className="app-dialog__body">{children}</div>
      {footer ? <footer className="app-dialog__footer">{footer}</footer> : null}
    </dialog>, document.body,
  );
}
