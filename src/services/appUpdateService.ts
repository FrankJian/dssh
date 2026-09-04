import { check, type Update } from "@tauri-apps/plugin-updater";

/** Optional proxy shared by automatic and manually initiated update checks. */
export const UPDATE_PROXY_KEY = "dssh.update.proxy";
/** Whether the application should check for updates when the main window starts. */
export const UPDATE_CHECK_ON_STARTUP_KEY = "dssh.update.checkOnStartup";

let startupCheck: Promise<Update | null> | null = null;

export function getUpdateProxy(): string {
  return localStorage.getItem(UPDATE_PROXY_KEY)?.trim() ?? "";
}

/** Startup checks are opt-in so a fresh installation never makes the request automatically. */
export function isUpdateCheckOnStartupEnabled(): boolean {
  return localStorage.getItem(UPDATE_CHECK_ON_STARTUP_KEY) === "true";
}

export function checkForUpdate(proxy = getUpdateProxy()): Promise<Update | null> {
  return check(proxy ? { proxy } : undefined);
}

/**
 * StrictMode mounts components twice during development. Keep one in-flight
 * request so the application still checks only once for each launch.
 */
export function checkForStartupUpdate(): Promise<Update | null> {
  if (!isUpdateCheckOnStartupEnabled()) {
    return Promise.resolve(null);
  }
  startupCheck ??= checkForUpdate();
  return startupCheck;
}
