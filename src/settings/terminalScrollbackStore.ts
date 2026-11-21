/** Scrollback counts displayed rows above the current screen, as in PuTTY. */
export const terminalScrollbackStorageKey = "dssh.terminal.scrollbackLines";
export const TERMINAL_SCROLLBACK_DEFAULT = 2000;
export const TERMINAL_SCROLLBACK_MAX = 100_000;

export function normalizeTerminalScrollback(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(TERMINAL_SCROLLBACK_MAX, Math.max(0, Math.round(value)));
}

function readScrollback(): number {
  try {
    const raw = localStorage.getItem(terminalScrollbackStorageKey);
    return raw === null || raw.trim() === "" ? TERMINAL_SCROLLBACK_DEFAULT : normalizeTerminalScrollback(Number(raw));
  } catch {
    return TERMINAL_SCROLLBACK_DEFAULT;
  }
}

let scrollback = readScrollback();
const listeners = new Set<() => void>();
function publish(next: number) {
  if (next === scrollback) return;
  scrollback = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key === terminalScrollbackStorageKey || event.key === null) publish(readScrollback());
  });
}

export function getTerminalScrollback() { return scrollback; }

export function subscribeTerminalScrollback(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setTerminalScrollback(value: number) {
  const next = normalizeTerminalScrollback(value);
  try {
    localStorage.setItem(terminalScrollbackStorageKey, String(next));
  } catch {
    throw new Error("保存终端滚动历史设置失败，请检查可用存储空间。");
  }
  publish(next);
}
