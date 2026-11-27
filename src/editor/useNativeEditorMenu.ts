import { useEffect, useRef, type RefObject } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { setNativeEditorContext } from "../services/editorService";
import { nativeMenuModel, type NativeEditorMenuGroup } from "./nativeMenu";

// Only the active workbench may publish or release this window’s menu context.
let nativeMenuOwner: symbol | null = null;

export function nativeEditorFocus(root: HTMLElement | null, target: Element | null): boolean {
  return !!root && !!target && (root.contains(target) || !!target.closest(".titlebar--editor")) && !target.closest(".editor-rich-code__toolbar")
    && !document.querySelector('[aria-modal="true"],[role="menu"],.select-menu__popover,.combobox__menu')
    && (!!target.closest(".monaco-editor, .editor-rich-host") || !target.closest('input,textarea,select,[contenteditable="true"]'));
}
export function useNativeEditorMenu(root: RefObject<HTMLElement | null>, enabled: boolean, execute: (id: string) => void, groups: () => NativeEditorMenuGroup[]) {
  const current = useRef({ enabled, execute, groups }); current.current = { enabled, execute, groups };
  useEffect(() => {
    if (!isTauri()) return;
    const owner = Symbol("editor-native-menu");
    let alive = true, previous = '', windowFocused = document.hasFocus();
    const update = () => {
      const active = alive && current.current.enabled && !!root.current;
      if (active) nativeMenuOwner = owner;
      else if (nativeMenuOwner === owner) nativeMenuOwner = null;
      else return;
      const target = document.activeElement;
      const textInput = !!target?.closest('input,textarea,select,[contenteditable="true"]') && !target.closest('.monaco-editor') && (!target.closest('.editor-rich-host') || !!target.closest('.editor-rich-code__toolbar'));
      const blocked = !!document.querySelector('[aria-modal="true"],[role="menu"],.select-menu__popover,.combobox__menu');
      const model = nativeMenuModel(active ? current.current.groups() : [], blocked);
      const signature = JSON.stringify([active, textInput, model.menus]);
      if (signature === previous) return;
      previous = signature;
      void setNativeEditorContext(active, model.menus, textInput).catch(() => { previous = ''; });
    };
    const changed = () => queueMicrotask(update);
    document.addEventListener('focusin', changed); document.addEventListener('focusout', changed);
    const focus = () => { windowFocused = true; changed(); };
    const blur = () => { windowFocused = false; };
    window.addEventListener('focus', focus); window.addEventListener('blur', blur);
    const observer = new MutationObserver(changed);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role'] });
    const timer = setInterval(update, 200);
    const webview = getCurrentWebview();
    const unlisten = webview.listen<{ ownerLabel: string; command: string }>('editor://native-menu', ({ payload }) => {
      if (nativeMenuOwner !== owner || !windowFocused || !document.hasFocus() || payload.ownerLabel !== webview.label || !alive || !current.current.enabled || document.querySelector('[aria-modal="true"],[role="menu"],.select-menu__popover,.combobox__menu')) return;
      const model = nativeMenuModel(current.current.groups(), false);
      const action = model.actions.get(payload.command);
      if (action && !action.disabled) {
        if (['undo', 'redo'].includes(action.id) && !nativeEditorFocus(root.current, document.activeElement)) return;
        action.run();
      }
      else if (nativeEditorFocus(root.current, document.activeElement) && ['undo', 'redo', 'editorCloseFile'].includes(payload.command)) current.current.execute(payload.command);
    });
    update();
    return () => {
      alive = false; clearInterval(timer); observer.disconnect();
      document.removeEventListener('focusin', changed); document.removeEventListener('focusout', changed); window.removeEventListener('focus', focus); window.removeEventListener('blur', blur);
      void unlisten.then(stop => stop()).catch(() => {});
      if (nativeMenuOwner === owner) { nativeMenuOwner = null; void setNativeEditorContext(false).catch(() => {}); }
    };
  }, [root, enabled]);
}
