import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBrowserLinkTarget } from "./browserPreferences.ts";

test("terminal links default to the built-in browser and reject arbitrary app names", () => {
  for (const value of [null, "", "unknown", "/bin/sh", "chrome --extra-flag"]) assert.equal(parseBrowserLinkTarget(value), "builtin");
  for (const value of ["system", "chrome", "edge"]) assert.equal(parseBrowserLinkTarget(value), value);
});
