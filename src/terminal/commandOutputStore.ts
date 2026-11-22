import { CommandOutputTracker, type CommandOutputRecord } from './commandOutput.ts';

// One JS runtime per workbench. Creation follows a successfully attached stream,
// never a renderer mount, and deletion follows session ownership/lifecycle.
const trackers = new Map<string, CommandOutputTracker>();
export const emptyCommandOutputs: readonly CommandOutputRecord[] = Object.freeze([]);
export function commandOutputTracker(sessionId: string) { return trackers.get(sessionId); }
export function attachCommandOutput(sessionId: string, replay = "") {
  let tracker = trackers.get(sessionId);
  if (!tracker) { tracker = new CommandOutputTracker(sessionId); trackers.set(sessionId, tracker); }
  tracker.restore(replay);
  return tracker;
}
export function forgetCommandOutput(sessionId: string) {
  trackers.get(sessionId)?.reset(true);
  trackers.delete(sessionId);
}
export function invalidateCommandOutputs() { for (const tracker of trackers.values()) tracker.reset(); }
export function exportCommandOutputs(sessionIds: string[]) {
  return Object.fromEntries(sessionIds.map(id => [id, trackers.get(id)?.snapshot() ?? []]));
}
export function importCommandOutputs(records: Record<string, CommandOutputRecord[]>) {
  for (const [sessionId, entries] of Object.entries(records)) {
    let tracker = trackers.get(sessionId);
    if (!tracker) { tracker = new CommandOutputTracker(sessionId); trackers.set(sessionId, tracker); }
    tracker.importCompleted(entries);
  }
}
