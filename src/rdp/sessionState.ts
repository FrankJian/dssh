import type { RdpSession } from "../models/rdp";

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
