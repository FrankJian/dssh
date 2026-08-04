import { check, type Update } from "@tauri-apps/plugin-updater";

/** Optional proxy shared by automatic and manually initiated update checks. */
export const UPDATE_PROXY_KEY = "dssh.update.proxy";

let startupCheck: Promise<Update | null> | null = null;

export function getUpdateProxy(): string {
  return localStorage.getItem(UPDATE_PROXY_KEY)?.trim() ?? "";
}

export function checkForUpdate(proxy = getUpdateProxy()): Promise<Update | null> {
  return check(proxy ? { proxy } : undefined);
}

/**
 * StrictMode mounts components twice during development. Keep one in-flight
 * request so the application still checks only once for each launch.
 */
export function checkForStartupUpdate(): Promise<Update | null> {
  startupCheck ??= checkForUpdate();
  return startupCheck;
}
