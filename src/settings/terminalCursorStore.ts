export type TerminalCursorStyle = "bar" | "underline" | "thick-underline" | "block";

export interface TerminalCursorPreferences {
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}

export const terminalCursorStorageKey = "dssh.terminal.cursor";
const defaults: TerminalCursorPreferences = { cursorStyle: "bar", cursorBlink: true };

export function normalizeTerminalCursorPreferences(value: unknown): TerminalCursorPreferences {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    cursorStyle: source.cursorStyle === "underline" || source.cursorStyle === "thick-underline" || source.cursorStyle === "block" ? source.cursorStyle : "bar",
    cursorBlink: typeof source.cursorBlink === "boolean" ? source.cursorBlink : defaults.cursorBlink,
  };
}

function readPreferences(): TerminalCursorPreferences {
  try {
    return normalizeTerminalCursorPreferences(JSON.parse(localStorage.getItem(terminalCursorStorageKey) ?? "null"));
  } catch {
    return { ...defaults };
  }
}

let preferences = readPreferences();
const listeners = new Set<() => void>();

function publish(next: TerminalCursorPreferences) {
  if (next.cursorStyle === preferences.cursorStyle && next.cursorBlink === preferences.cursorBlink) return;
  preferences = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === terminalCursorStorageKey || event.key === null) publish(readPreferences());
  });
}

export function getTerminalCursorPreferences() {
  return preferences;
}

/** xterm has no thick-underline style; its DOM underline is styled by CSS. */
export function getTerminalCursorOptions(cursor = preferences): {
  cursorStyle: "bar" | "underline" | "block";
  cursorBlink: boolean;
} {
  return {
    cursorStyle: cursor.cursorStyle === "thick-underline" ? "underline" : cursor.cursorStyle,
    cursorBlink: cursor.cursorBlink,
  };
}

export function subscribeTerminalCursorPreferences(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setTerminalCursorPreferences(patch: Partial<TerminalCursorPreferences>) {
  // Merge with current storage so two windows changing separate fields do not
  // overwrite one another merely because a storage notification arrived late.
  const next = normalizeTerminalCursorPreferences({ ...readPreferences(), ...patch });
  try {
    localStorage.setItem(terminalCursorStorageKey, JSON.stringify(next));
  } catch {
    throw new Error("保存终端光标设置失败，请检查可用存储空间。");
  }
  publish(next);
}
