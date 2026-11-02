import test from "node:test";
import assert from "node:assert/strict";
import { dismissRdpSession, mergeRdpSession, reconcileRdpSnapshot, visibleRdpSessions } from "./sessionState.ts";
const session = (revision, status, id = "rdp:test") => ({ id, profileId: "profile", title: "Test", status, message: null, revision });
test("removed failures stay hidden after events and reloads, while new attempts remain visible", () => {
  const failed = session(3, "failed");
  const dismissed = dismissRdpSession([failed], new Set(), failed.id);
  const updated = mergeRdpSession([failed], { ...failed, revision: 4, message: "Exit reason" });
  assert.deepEqual(visibleRdpSessions(updated, dismissed), []);
  assert.deepEqual(visibleRdpSessions(reconcileRdpSnapshot([], updated, false), dismissed), []);
  const retry = session(0, "starting", "rdp:retry");
  assert.deepEqual(visibleRdpSessions([...updated, retry], dismissed), [retry]);
});
test("active sessions cannot be removed", () => {
  const dismissed = new Set();
  for (const status of ["starting", "connecting", "connected", "disconnecting"]) {
    assert.equal(dismissRdpSession([session(1, status)], dismissed, "rdp:test"), dismissed);
  }
  assert.equal(dismissRdpSession([], dismissed, "missing"), dismissed);
});
test("normal closes disappear while errors and their reasons remain", () => {
  const failed = {...session(3, "failed", "failure"), message: "Network interrupted"};
  const closed = session(4, "closed");
  const current = [closed, failed];
  assert.deepEqual(visibleRdpSessions(current), [failed]);
  assert.deepEqual(visibleRdpSessions(mergeRdpSession(current, session(2, "connected"))), [failed]);
  assert.deepEqual(visibleRdpSessions(reconcileRdpSnapshot(current, [session(1, "connected"), failed], false)), [failed]);
});
test("late connected events cannot revive a closed desktop", () => {
  const closed = session(3, "closed");
  assert.deepEqual(mergeRdpSession([closed], session(2, "connected")), [closed]);
});
test("an in-flight snapshot cannot erase a newly delivered desktop", () => {
  const added = session(0, "starting");
  assert.deepEqual(reconcileRdpSnapshot([added], [], true), [added]);
  assert.deepEqual(reconcileRdpSnapshot([added], [], false), []);
});
test("snapshots preserve a more recent failure event", () => {
  const failed = session(2, "failed");
  assert.deepEqual(reconcileRdpSnapshot([failed], [session(1, "connecting")], false), [failed]);
});
