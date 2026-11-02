import type { RdpSession } from "../models/rdp";

// Retain closed revisions internally so delayed events cannot revive them.
export function visibleRdpSessions(sessions: RdpSession[], dismissed: ReadonlySet<string> = new Set()): RdpSession[] {
  return sessions.filter((session) => session.status !== "closed" && !dismissed.has(session.id));
}

export function dismissRdpSession(sessions: RdpSession[], dismissed: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const session = sessions.find((item) => item.id === id);
  if (!session || (session.status !== "closed" && session.status !== "failed")) return dismissed;
  return new Set([...dismissed, id]);
}

export function mergeRdpSession(current: RdpSession[], incoming: RdpSession): RdpSession[] {
  const old = current.find((session) => session.id === incoming.id);
  if (old && old.revision >= incoming.revision) return current;
  return [...current.filter((session) => session.id !== incoming.id), incoming];
}

export function reconcileRdpSnapshot(current: RdpSession[], snapshot: RdpSession[], hadConcurrentEvents: boolean) {
  // An event delivered while a list request was in flight can describe a session
  // created after the backend took its snapshot. Do not erase that new session.
  const retained = hadConcurrentEvents ? current : current.filter((session) => snapshot.some((s) => s.id === session.id));
  return snapshot.reduce(mergeRdpSession, retained);
}
