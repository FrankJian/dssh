export type SessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "disconnected"
  | "failed";

export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * A transient xterm screen capture used only while a terminal workspace moves
 * between native windows. It is never persisted to disk or sent to a server.
 */
export interface TerminalSnapshot {
  data: string;
  cols: number;
  rows: number;
}

export interface TerminalSession {
  id: string;
  kind: "local" | "ssh";
  profileId: string;
  title: string;
  status: SessionStatus;
}
