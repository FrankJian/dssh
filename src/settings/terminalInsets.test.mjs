import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getTerminalWorkspaceInset,
  terminalWorkspaceInsetKey,
  terminalWorkspaceRightInsetKey,
  terminalWorkspaceBottomInsetKey,
} from "./settings.ts";

const values = new Map();
globalThis.localStorage = { getItem: (key) => values.get(key) ?? null };

test("each edge inherits the legacy inset until independently configured", () => {
  values.set(terminalWorkspaceInsetKey, "20");
  assert.equal(getTerminalWorkspaceInset("right"), 20);
  assert.equal(getTerminalWorkspaceInset("bottom"), 20);
  values.set(terminalWorkspaceBottomInsetKey, "120");
  assert.equal(getTerminalWorkspaceInset("bottom"), 120);
  assert.equal(getTerminalWorkspaceInset("right"), 20);
  values.set(terminalWorkspaceRightInsetKey, "0");
  assert.equal(getTerminalWorkspaceInset("right"), 0);
  assert.equal(getTerminalWorkspaceInset("bottom"), 120);
});

test("missing or invalid inset values use safe defaults and bounds", () => {
  values.clear();
  assert.equal(getTerminalWorkspaceInset("right"), 4);
  assert.equal(getTerminalWorkspaceInset("bottom"), 4);
  values.set(terminalWorkspaceBottomInsetKey, "invalid");
  assert.equal(getTerminalWorkspaceInset("bottom"), 4);
  values.set(terminalWorkspaceBottomInsetKey, "999");
  assert.equal(getTerminalWorkspaceInset("bottom"), 240);
  values.set(terminalWorkspaceRightInsetKey, "-1");
  assert.equal(getTerminalWorkspaceInset("right"), 0);
});
