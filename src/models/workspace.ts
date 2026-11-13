import type { PaneLayout } from "../terminal/usePaneLayout";
import type { TerminalSnapshot } from "./terminal";

export type DetachedWorkspaceKind = "terminal" | "sftp" | "workbench";

export interface DetachedTerminalWorkspace {
  tabSessionId: string;
  sessionIds: string[];
  layout: PaneLayout | null;
  /** Keep the label in sync with the connected host unless the user renamed it. */
  autoTitle?: boolean;
  /** Latest screen state, used once when this workspace returns to its parent. */
  terminalSnapshots?: Record<string, TerminalSnapshot>;
}

export interface DetachedSftpWorkspace {
  profileId: string;
  asset?: import("../terminal/terminalTarget").JumpServerSftpTarget;
  remotePath?: string;
  localPath?: string;
}

export interface DetachedWorkspace {
  label: string;
  parentLabel: string;
  kind: DetachedWorkspaceKind;
  title: string;
  terminal: DetachedTerminalWorkspace | null;
  sftp: DetachedSftpWorkspace | null;
  workbench?: DetachedWorkbench | null;
}

export interface OpenDetachedTerminalRequest {
  parentLabel: string;
  title: string;
  terminal: DetachedTerminalWorkspace;
}

export interface OpenDetachedSftpRequest extends DetachedSftpWorkspace {
  parentLabel: string;
  title: string;
}

export interface DetachedWorkbench {
  sessionIds: string[];
  layouts: PaneLayout[];
  terminalNames: Record<string, string>;
  paneNames: Record<string, string>;
  terminalSnapshots: Record<string, TerminalSnapshot>;
  sftpTabs: import("../app/useWorkspace").SftpTab[];
  tabOrder: string[];
  s3ProfileIds: string[];
}

export function workspaceSessionIds(workspace: DetachedWorkspace): string[] {
  return workspace.workbench?.sessionIds ?? workspace.terminal?.sessionIds ?? [];
}
