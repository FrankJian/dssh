import { useEffect } from "react";
import { ACTION_SHORTCUT_IDS, resolveActionShortcut, type ActionShortcutId } from "./shortcuts";

export type ShortcutActions = Partial<Record<ActionShortcutId, () => void | Promise<unknown>>>;

/** Share dispatch rules between the main and detached workspaces. */
export function useActionShortcuts(actions: ShortcutActions, disabled = false) {
  useEffect(() => {
    if (disabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Keep dialogs, key recorders, menus and editor text entry in control.
      const target = event.target instanceof Element ? event.target : null;
      const id = resolveActionShortcut(event, ACTION_SHORTCUT_IDS.filter((id) => Boolean(actions[id])), {
        blocked: Boolean(document.querySelector('.profile-editor-backdrop, [aria-modal="true"], [role="dialog"], [role="alertdialog"], .select-menu__popover, .combobox__menu, [role="menu"]') || target?.closest(".monaco-editor")),
        editing: !target?.closest(".terminal-view") && Boolean(target?.closest('input, textarea, select, [contenteditable="true"]')),
      });
      if (id) {
        event.preventDefault();
        void actions[id]?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, disabled]);
}
