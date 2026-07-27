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

export interface TerminalSession {
  id: string;
  kind: "local" | "ssh";
  profileId: string;
  title: string;
  status: SessionStatus;
}
