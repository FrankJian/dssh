/**
 * Lightweight OS detection for platform-specific UI behavior. Uses the webview
 * user-agent so it works without pulling in the Tauri OS plugin. Evaluated once
 * at module load since the platform never changes at runtime.
 */
export const isMacOS: boolean =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
