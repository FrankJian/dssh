import type { TerminalSession } from "../models/terminal";

/** Only offer terminal navigation for a connected shell belonging to this SFTP host. */
export function findSftpTerminal(sessions: TerminalSession[], profileId: string, activeId: string | null): TerminalSession | undefined {
  const candidates = sessions.filter((session) => session.kind === "ssh" && session.profileId === profileId && session.status === "connected");
  return candidates.find((session) => session.id === activeId) ?? candidates[0];
}
