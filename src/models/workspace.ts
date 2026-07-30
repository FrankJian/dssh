import type { PaneLayout } from "../terminal/usePaneLayout";

export type DetachedWorkspaceKind = "terminal" | "sftp";

export interface DetachedTerminalWorkspace {
  tabSessionId: string;
  sessionIds: string[];
  layout: PaneLayout | null;
}

export interface DetachedSftpWorkspace {
  profileId: string;
}

export interface DetachedWorkspace {
  label: string;
  parentLabel: string;
  kind: DetachedWorkspaceKind;
  title: string;
  terminal: DetachedTerminalWorkspace | null;
  sftp: DetachedSftpWorkspace | null;
}

export interface OpenDetachedTerminalRequest {
  parentLabel: string;
  title: string;
  terminal: DetachedTerminalWorkspace;
}

export interface OpenDetachedSftpRequest {
  parentLabel: string;
  title: string;
  profileId: string;
}
