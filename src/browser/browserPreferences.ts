export const BROWSER_LINK_TARGET_KEY = "dssh.browser.terminalLinkTarget";
export type BrowserLinkTarget = "builtin" | "system" | "chrome" | "edge";
export function parseBrowserLinkTarget(value: string | null): BrowserLinkTarget {
  return value === "system" || value === "chrome" || value === "edge" ? value : "builtin";
}
export function getBrowserLinkTarget(): BrowserLinkTarget {
  return parseBrowserLinkTarget(localStorage.getItem(BROWSER_LINK_TARGET_KEY));
}
