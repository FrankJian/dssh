import type { ActivityId } from "./ActivityBar.tsx";

export const SIDEBAR_COLLAPSED_KEY = "dssh.sidebar.collapsed";
export type SidebarContext = ActivityId | "editor" | "files";
export const SIDEBAR_LABELS: Record<SidebarContext, string> = {
  sessions: "会话", connections: "连接管理", tools: "工具箱", sftp: "SFTP",
  s3: "S3", artifactory: "Artifactory", editor: "文件编辑器", files: "文件列表",
};

/** Page-level activities take priority over a background workspace tab. */
export function sidebarDetailsContext(activity: ActivityId, editorActive: boolean, browserActive: boolean, filesActive = false): SidebarContext | null {
  if (activity !== "sessions" && activity !== "sftp") return activity;
  if (editorActive) return "editor";
  if (browserActive) return null;
  if (filesActive) return "files";
  return activity;
}

export function readSidebarCollapsed(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; }
  catch { return false; }
}
