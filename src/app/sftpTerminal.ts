import type { TerminalSession } from "../models/terminal";

export function isOpenSshTerminal(session: TerminalSession): boolean {
  return session.kind === "ssh" && (
    session.status === "connected" || session.status === "connecting" || session.status === "reconnecting"
  );
}

/** Commands need a connected shell; switching views may also target a pending shell. */
export function findSftpTerminal(
  sessions: TerminalSession[],
  profileId: string,
  activeId: string | null,
  { includePending = false } = {},
): TerminalSession | undefined {
  const candidates = sessions.filter((session) =>
    session.profileId === profileId && isOpenSshTerminal(session) && (includePending || session.status === "connected"),
  );
  return candidates.find((session) => session.id === activeId) ?? candidates[0];
}
