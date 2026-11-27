import test from "node:test";
import assert from "node:assert/strict";
import { sidebarDetailsContext, readSidebarCollapsed, SIDEBAR_COLLAPSED_KEY, SIDEBAR_LABELS } from "./sidebarDetails.ts";

test("page activities own details even with a background editor or browser", () => {
  for (const activity of ["connections", "tools", "s3", "artifactory"]) {
    for (const editor of [false, true]) for (const browser of [false, true]) {
      assert.equal(sidebarDetailsContext(activity, editor, browser, true), activity);
    }
  }
});
test("workspace surfaces select exactly one matching details owner", () => {
  for (const activity of ["sessions", "sftp"]) {
    assert.equal(sidebarDetailsContext(activity, false, false), activity);
    assert.equal(sidebarDetailsContext(activity, true, false, true), "editor");
    assert.equal(sidebarDetailsContext(activity, false, true, true), null);
    assert.equal(sidebarDetailsContext(activity, false, false, true), "files");
  }
  for (const context of ["sessions", "sftp", "connections", "tools", "s3", "artifactory", "editor", "files"]) assert.ok(SIDEBAR_LABELS[context]);
});
test("existing collapse preference survives and unavailable storage defaults open", () => {
  for (const raw of [null, "false", "garbage", "true"]) {
    assert.equal(readSidebarCollapsed({ getItem(key) { assert.equal(key, SIDEBAR_COLLAPSED_KEY); return raw; } }), raw === "true");
  }
  assert.equal(readSidebarCollapsed({ getItem() { throw new Error("unavailable"); } }), false);
});
