export const terminalSuperKeyStorageKey = "dssh.terminal.superKeyVisible";

function readVisible(): boolean {
  try {
    return localStorage.getItem(terminalSuperKeyStorageKey) !== "false";
  } catch {
    return true;
  }
}

let visible = readVisible();
const listeners = new Set<() => void>();

function publish(next: boolean) {
  if (next === visible) return;
  visible = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === terminalSuperKeyStorageKey || event.key === null) publish(readVisible());
  });
}

export const getTerminalSuperKeyVisible = () => visible;

export function subscribeTerminalSuperKey(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setTerminalSuperKeyVisible(next: boolean) {
  try {
    localStorage.setItem(terminalSuperKeyStorageKey, String(next));
  } catch {
    throw new Error("保存终端超级键设置失败，请检查可用存储空间。");
  }
  publish(next);
}
