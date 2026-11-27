import { useEffect, useRef } from "react";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";

export interface EditorWelcomeAction {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string[];
  run(): void;
}

export function EditorWelcome({ actions, disabled, autoFocus = false }: { actions: EditorWelcomeAction[]; disabled: boolean; autoFocus?: boolean }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoFocus || disabled) return;
    const doc = root.current?.ownerDocument;
    if (!doc || doc.querySelector('[aria-modal="true"], [role="menu"], .select-menu__popover, .combobox__menu')) return;
    const focused = doc.activeElement;
    if (root.current?.contains(focused) || focused?.closest('input, textarea, select, [contenteditable="true"]')) return;
    root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [autoFocus, disabled]);
  return <section ref={root} className="editor-welcome" aria-label="编辑器欢迎页">
    <div className="editor-welcome__inner">
      <svg className="editor-welcome__mark" viewBox="0 0 160 160" fill="none" aria-hidden="true" focusable="false">
        <path d="m38 48 38 32-38 32m50 0h36" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="editor-welcome__actions" role="group" aria-label="开始编辑">
        {actions.map(action => <Button key={action.id} variant="ghost" className="editor-welcome__action"
          aria-label={action.label} title={`${action.label}${action.shortcut?.length ? ` (${action.shortcut.join(" ")})` : ""}`}
          disabled={disabled} onClick={action.run}>
          <Icon name={action.icon} width="18" height="18" />
          <span className="editor-welcome__label">{action.label}</span>
          {action.shortcut?.length ? <span className="editor-welcome__keys" aria-hidden="true">{action.shortcut.map((key, index) => <kbd key={`${index}-${key}`}>{key}</kbd>)}</span> : null}
        </Button>)}
      </div>
    </div>
  </section>;
}
