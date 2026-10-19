import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAppLockStatus,
  lockApp,
  lockAppIfIdle,
  onAppLockState,
  recordAppActivity,
  unlockApp,
  updateAppLockSettings,
  type AppLockStatus,
  type UpdateAppLockSettingsRequest,
} from "../services/appLockService";

const ACTIVITY_THROTTLE_MS = 10_000;
const IDLE_CHECK_INTERVAL_MS = 15_000;

/**
 * One backend-owned lock state is shared by every native window. Each renderer
 * reports user activity and polls the idle decision, so detached workspaces
 * cannot keep sensitive content visible after the main window locks.
 */
export function useAppLock() {
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const statusRef = useRef<AppLockStatus | null>(null);
  const lastActivityAtRef = useRef(0);

  const applyStatus = useCallback((next: AppLockStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAppLockStatus()
      .then((next) => {
        if (!cancelled) applyStatus(next);
      })
      .catch(() => {
        // Keep the application usable if state cannot be read during startup.
      });
    const unlistenPromise = onAppLockState((next) => applyStatus(next));
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applyStatus]);

  const reportActivity = useCallback(() => {
    const current = statusRef.current;
    if (!current?.settings.enabled || current.locked) return;
    const now = Date.now();
    if (now - lastActivityAtRef.current < ACTIVITY_THROTTLE_MS) return;
    lastActivityAtRef.current = now;
    void recordAppActivity().catch(() => undefined);
  }, []);

  useEffect(() => {
    const activityEvents: Array<keyof DocumentEventMap> = ["keydown", "pointerdown", "touchstart", "wheel"];
    for (const eventName of activityEvents) {
      document.addEventListener(eventName, reportActivity, { capture: true, passive: true });
    }
    return () => {
      for (const eventName of activityEvents) {
        document.removeEventListener(eventName, reportActivity, { capture: true });
      }
    };
  }, [reportActivity]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = statusRef.current;
      if (!current?.settings.enabled || current.locked || !current.settings.autoLockEnabled) return;
      void lockAppIfIdle().then(applyStatus).catch(() => undefined);
    }, IDLE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [applyStatus]);

  const lock = useCallback(async () => {
    const next = await lockApp();
    applyStatus(next);
  }, [applyStatus]);

  const unlock = useCallback(async (password: string) => {
    const next = await unlockApp(password);
    applyStatus(next);
    reportActivity();
  }, [applyStatus, reportActivity]);

  const updateSettings = useCallback(async (request: UpdateAppLockSettingsRequest) => {
    const next = await updateAppLockSettings(request);
    applyStatus(next);
  }, [applyStatus]);

  return { lock, status, unlock, updateSettings };
}
