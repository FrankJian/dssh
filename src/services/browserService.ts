import { invokeCommand } from "./tauri";

export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface BrowserTab { id: string; owner: string; title: string; url: string; loading: boolean }
export interface BrowserTabsEvent { revision: number; tabs: BrowserTab[]; activeId: string | null }

export const openBrowser = (url?: string, detached = false) => invokeCommand<BrowserTab>("open_browser", { url: url ?? null, detached });
export const listBrowserTabs = () => invokeCommand<BrowserTabsEvent>("list_browser_tabs");
export const closeBrowserTab = (id: string) => invokeCommand<void>("close_browser_tab", { id });
export const renameBrowserTab = (id: string, title: string) => invokeCommand<void>("rename_browser_tab", { id, title });
export const detachBrowserTab = (id: string) => invokeCommand<void>("detach_browser_tab", { id });
export const mountBrowser = (id: string, url: string, bounds: BrowserBounds, navigate = true) => invokeCommand<void>("mount_browser", { id, url, bounds, navigate });
export const resizeBrowser = (id: string, bounds: BrowserBounds, visible: boolean) => invokeCommand<void>("resize_browser", { id, bounds, visible });
export const browserAction = (id: string, action: "back" | "forward" | "reload" | "stop") => invokeCommand<void>("browser_action", { id, action });
export const openBrowserExternal = (url: string, browser: "system" | "chrome" | "edge") => invokeCommand<void>("open_browser_external", { url, browser });
