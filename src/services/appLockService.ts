import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "./tauri";

export interface AppLockSettings {
  enabled: boolean;
  autoLockEnabled: boolean;
  timeoutMinutes: number;
  hasPassword: boolean;
}

export interface AppLockStatus {
  settings: AppLockSettings;
  locked: boolean;
}

export interface UpdateAppLockSettingsRequest {
  enabled: boolean;
  autoLockEnabled: boolean;
  timeoutMinutes: number;
  currentPassword?: string;
  newPassword?: string;
}

export function getAppLockStatus() {
  return invokeCommand<AppLockStatus>("get_app_lock_status");
}

export function updateAppLockSettings(request: UpdateAppLockSettingsRequest) {
  return invokeCommand<AppLockStatus>("update_app_lock_settings", { request });
}

export function lockApp() {
  return invokeCommand<AppLockStatus>("lock_app");
}

export function unlockApp(password: string) {
  return invokeCommand<AppLockStatus>("unlock_app", { password });
}

export function recordAppActivity() {
  return invokeCommand<void>("record_app_activity");
}

export function lockAppIfIdle() {
  return invokeCommand<AppLockStatus>("lock_app_if_idle");
}

export function onAppLockState(handler: (status: AppLockStatus) => void) {
  return listen<AppLockStatus>("app://lock-state", (event) => handler(event.payload));
}
