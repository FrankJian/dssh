import test from "node:test";
import assert from "node:assert/strict";
import { mergeRdpSession, reconcileRdpSnapshot } from "./sessionState.ts";
const session = (revision, status, id = "rdp:test") => ({ id, profileId: "profile", title: "Test", status, message: null, revision });
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
