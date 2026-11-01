import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileWorkspaceTabFocus } from "./workspaceTabFocus.ts";

function visit(ids, openIds = ids) {
  let history = [];
  for (const id of ids) history = reconcileWorkspaceTabFocus(history, id, openIds).history;
  return history;
}

test("closing the newest browser restores the previous browser before SSH", () => {
  const history = visit(["ssh", "browser-1", "browser-2"]);
  const result = reconcileWorkspaceTabFocus(history, "browser-2", ["ssh", "browser-1"]);
  assert.equal(result.activeId, "browser-1");
  assert.deepEqual(result.history, ["ssh", "browser-1"]);
  assert.equal(reconcileWorkspaceTabFocus(result.history, "browser-1", ["ssh"]).activeId, "ssh");
});

test("manual activation wins over visual tab order", () => {
  const open = ["browser-1", "ssh", "browser-2"];
  const history = visit(["ssh", "browser-1", "browser-2", "browser-1"], open);
  assert.equal(reconcileWorkspaceTabFocus(history, "browser-1", ["ssh", "browser-2"]).activeId, "browser-2");
});

test("closing an inactive browser preserves the current tab, including during async close", () => {
  const history = visit(["ssh", "browser-1", "browser-2", "ssh"]);
  assert.equal(reconcileWorkspaceTabFocus(history, "ssh", ["ssh", "browser-1"]).activeId, "ssh");
});

test("history crosses tab kinds and skips closed or detached tabs", () => {
  const history = visit(["ssh", "browser-1", "sftp:host", "browser-2"]);
  assert.equal(reconcileWorkspaceTabFocus(history, "browser-2", ["ssh", "sftp:host"]).activeId, "sftp:host");
  assert.equal(reconcileWorkspaceTabFocus(history, "browser-2", ["ssh"]).activeId, "ssh");
});

test("empty workspaces and restored tabs without history have deterministic fallbacks", () => {
  assert.deepEqual(reconcileWorkspaceTabFocus(["browser-1"], "browser-1", []), { history: [], activeId: null });
  assert.equal(reconcileWorkspaceTabFocus([], "missing", ["browser-2", "ssh"]).activeId, "browser-2");
});
