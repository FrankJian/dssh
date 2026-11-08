import assert from "node:assert/strict";
import test from "node:test";
import { activateFilePaneDrag, filePaneDrop } from "./filePaneDrag.ts";
function drag(side = "local") {
  return {
    pointerId: 7,
    side,
    paths: ["/demo/a", "/demo/b"],
    name: "a",
    startX: 10,
    startY: 10,
    active: false,
  };
}
test("clicks and small pointer movement cannot start a transfer", () => {
  const session = drag();
  assert.equal(activateFilePaneDrag(session, 7, 12, 12), false);
  assert.equal(filePaneDrop(session, 7, "remote"), null);
  assert.equal(activateFilePaneDrag(session, 8, 300, 10), false);
  assert.equal(session.active, false);
});
test("a drag uploads the selected batch only to the opposite pane", () => {
  const session = drag();
  assert.equal(activateFilePaneDrag(session, 7, 15, 10), true);
  assert.deepEqual(filePaneDrop(session, 7, "remote"), {
    side: "local",
    paths: ["/demo/a", "/demo/b"],
  });
  assert.equal(filePaneDrop(session, 7, "local"), null);
  assert.equal(filePaneDrop(session, 7, null), null);
  assert.equal(filePaneDrop(session, 8, "remote"), null);
});
test("remote-to-local drag requests a download and preserves its payload snapshot", () => {
  const session = drag("remote");
  activateFilePaneDrag(session, 7, 10, 30);
  const payload = filePaneDrop(session, 7, "local");
  assert.deepEqual(payload, { side: "remote", paths: ["/demo/a", "/demo/b"] });
  session.paths.length = 0;
  assert.equal(payload.paths.length, 2);
  assert.equal(filePaneDrop(session, 7, "local"), null);
});
