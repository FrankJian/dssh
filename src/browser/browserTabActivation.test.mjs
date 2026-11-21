import assert from "node:assert/strict";
import { test } from "node:test";
import { browserSnapshotActivation } from "./browserTabActivation.ts";

test("an empty detached workbench activates the incoming page even if its move event arrived before subscription", () => {
  assert.equal(browserSnapshotActivation({ activeId: null, tabs: [] }, true), null);
  assert.equal(browserSnapshotActivation({ activeId: null, tabs: [{ id: "moved-page" }] }, true), "moved-page");
});

test("ordinary snapshots do not switch away from a terminal or a manually selected page", () => {
  const metadataUpdate = { activeId: null, tabs: [{ id: "background-page" }, { id: "selected-page" }] };
  assert.equal(browserSnapshotActivation(metadataUpdate, false), null);
});

test("an explicit new-page activation takes priority over the initial fallback", () => {
  const snapshot = { activeId: "new-page", tabs: [{ id: "old-page" }, { id: "new-page" }] };
  assert.equal(browserSnapshotActivation(snapshot, true), "new-page");
  assert.equal(browserSnapshotActivation(snapshot, false), "new-page");
});

test("a page no longer owned by this workbench cannot be selected from its snapshot", () => {
  assert.equal(browserSnapshotActivation({ activeId: "moved-away", tabs: [{ id: "still-owned" }] }, false), null);
});
