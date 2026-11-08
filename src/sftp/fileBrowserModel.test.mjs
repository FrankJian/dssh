import assert from "node:assert/strict";
import test from "node:test";
import {
  visibleEntries,
  rangeSelection,
  visitDirectory,
} from "./fileBrowserModel.ts";
const file = (name, props = {}) => ({
  name,
  path: `/${name}`,
  isDir: false,
  isSymlink: false,
  size: 10,
  modified: null,
  ...props,
});
test("natural ordering keeps directories first in either direction and does not mutate listings", () => {
  const entries = [
    file("file11"),
    file("folder", { isDir: true }),
    file("file2"),
  ];
  assert.deepEqual(
    visibleEntries(entries, "", false, "name", false).map((e) => e.name),
    ["folder", "file2", "file11"],
  );
  assert.deepEqual(
    visibleEntries(entries, "", false, "name", true).map((e) => e.name),
    ["folder", "file11", "file2"],
  );
  assert.equal(entries[0].name, "file11");
});
test("range selection follows the filtered and sorted display, excluding invisible files", () => {
  const entries = [
    file("a.txt", { size: 30 }),
    file("b.txt", { size: 10 }),
    file(".secret.txt"),
    file("c.log"),
    file("c.txt", { size: 20 }),
  ];
  const visible = visibleEntries(entries, ".TXT", false, "size", false);
  assert.deepEqual(rangeSelection(visible, "/b.txt", "/a.txt"), [
    "/b.txt",
    "/c.txt",
    "/a.txt",
  ]);
  assert.deepEqual(rangeSelection(visible, "/.secret.txt", "/a.txt"), [
    "/a.txt",
  ]);
  assert.equal(visibleEntries(entries, "", true, "name", false).length, 5);
});
test("modified sort accepts missing server timestamps", () => {
  assert.deepEqual(
    visibleEntries(
      [file("old"), file("new", { modified: 100 })],
      "",
      false,
      "modified",
      true,
    ).map((e) => e.name),
    ["new", "old"],
  );
});
test("history refresh preserves forward navigation and a new branch discards it", () => {
  const history = { paths: ["/", "/a", "/a/b"], index: 1 };
  assert.deepEqual(visitDirectory(history, "/a"), history);
  assert.deepEqual(visitDirectory(history, "/c"), {
    paths: ["/", "/a", "/c"],
    index: 2,
  });
  let bounded = { paths: [], index: -1 };
  for (let i = 0; i < 120; i++) bounded = visitDirectory(bounded, `/${i}`);
  assert.equal(bounded.paths.length, 100);
  assert.equal(bounded.paths[bounded.index], "/119");
});
