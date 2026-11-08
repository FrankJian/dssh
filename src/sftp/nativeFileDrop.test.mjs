import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeDropClientPoint,
  nativeUploadEntries,
} from "./nativeFileDrop.ts";
const entry = (path, isDir = false) => ({
  name: path.split(/[\\/]/).pop(),
  path,
  isDir,
  isSymlink: false,
  size: 12,
  modified: null,
});
test("native physical drop coordinates account for Retina, fractional DPI and zoom", () => {
  assert.deepEqual(
    nativeDropClientPoint(
      { x: 900, y: 600 },
      { width: 2400, height: 1600 },
      { width: 1200, height: 800 },
    ),
    { x: 450, y: 300 },
  );
  assert.deepEqual(
    nativeDropClientPoint(
      { x: 1125, y: 750 },
      { width: 3000, height: 2000 },
      { width: 1200, height: 800 },
    ),
    { x: 450, y: 300 },
  );
  assert.equal(
    nativeDropClientPoint(
      { x: 10, y: 10 },
      { width: 0, height: 0 },
      { width: 1200, height: 800 },
    ),
    null,
  );
  assert.equal(
    nativeDropClientPoint(
      { x: NaN, y: 0 },
      { width: 2400, height: 1600 },
      { width: 1200, height: 800 },
    ),
    null,
  );
});
test("Finder drops resolve files and folders outside the currently displayed local directory", async () => {
  const calls = [];
  const files = [entry("/Finder/report.txt"), entry("/Finder/project", true)];
  const result = await nativeUploadEntries(
    ["/Finder/report.txt", "/Finder/project/", "/Finder/report.txt"],
    async (parent) => {
      calls.push(parent);
      return { path: parent, entries: files };
    },
  );
  assert.deepEqual(result, files);
  assert.deepEqual(calls, ["/Finder"]);
});
test("Explorer drops support drive roots as parents, UNC paths and canonical listing paths", async () => {
  const files = [
    entry("C:\\Report.txt"),
    entry("\\\\server\\share\\docs", true),
  ];
  const calls = [];
  const result = await nativeUploadEntries(
    ["C:\\report.txt", "\\\\server\\share\\docs"],
    async (parent) => {
      calls.push(parent);
      return { path: parent, entries: files };
    },
  );
  assert.deepEqual(result, files);
  assert.deepEqual(calls, ["C:\\", "\\\\server\\share"]);
});
test("a dropped directory covers nested selections without matching sibling prefixes", async () => {
  const data = {
    "/Finder": [
      entry("/Finder/project", true),
      entry("/Finder/project-copy", true),
    ],
    "/Finder/project": [entry("/Finder/project/a.txt")],
  };
  const result = await nativeUploadEntries(
    ["/Finder/project/a.txt", "/Finder/project", "/Finder/project-copy"],
    async (parent) => ({ path: parent, entries: data[parent] }),
  );
  assert.deepEqual(
    result.map((file) => file.path),
    ["/Finder/project", "/Finder/project-copy"],
  );
});
test("two different source paths with the same destination name cannot silently overwrite each other", async () => {
  await assert.rejects(
    nativeUploadEntries(
      ["/a/config.json", "/b/config.json"],
      async (parent) => ({
        path: parent,
        entries: [entry(`${parent}/config.json`)],
      }),
    ),
    /同名/,
  );
});
test("missing paths, filesystem roots and relative payloads fail before any upload", async () => {
  const list = async (path) => ({ path, entries: [] });
  await assert.rejects(
    nativeUploadEntries(["/Finder/missing.txt"], list),
    /移动或删除/,
  );
  for (const path of [
    "/",
    "C:\\",
    "\\\\server\\share",
    "relative.txt",
    "/Finder/..",
    "/Finder/invalid\0name",
  ])
    await assert.rejects(nativeUploadEntries([path], list));
});

test("macOS logical drag positions hit the full offset remote pane on Retina", () => {
  const physical = { width: 2880, height: 1800 };
  const viewport = { width: 1440, height: 900 };
  // Activity rail + sidebar before the remote pane; the local pane starts at 870.
  const remote = { left: 296, right: 830, top: 100, bottom: 850 };
  const inside = (point) =>
    point &&
    point.x >= remote.left &&
    point.x < remote.right &&
    point.y >= remote.top &&
    point.y < remote.bottom;
  for (const x of [296, 310, 550, 829]) {
    const point = nativeDropClientPoint({ x, y: 400 }, physical, viewport, 2);
    assert.deepEqual(point, { x, y: 400 });
    assert.equal(inside(point), true, `remote x=${x}`);
  }
  for (const x of [0, 295, 830, 870, 1200])
    assert.equal(
      inside(nativeDropClientPoint({ x, y: 400 }, physical, viewport, 2)),
      false,
      `outside x=${x}`,
    );
  // The old conversion halved the point again and missed the left edge.
  assert.equal(
    inside(nativeDropClientPoint({ x: 310, y: 400 }, physical, viewport)),
    false,
  );
  // It also incorrectly mapped a real local-pane drop into the remote pane.
  assert.equal(
    inside(nativeDropClientPoint({ x: 1200, y: 400 }, physical, viewport)),
    true,
  );
});

test("macOS logical points and Windows pixels agree under DPI scaling and webview zoom", () => {
  const physical = { width: 3000, height: 2000 };
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(
    nativeDropClientPoint({ x: 500, y: 375 }, physical, viewport, 2),
    { x: 400, y: 300 },
  );
  assert.deepEqual(
    nativeDropClientPoint({ x: 1000, y: 750 }, physical, viewport, 1),
    { x: 400, y: 300 },
  );
  for (const scale of [0, -1, NaN, Infinity])
    assert.equal(
      nativeDropClientPoint({ x: 10, y: 20 }, physical, viewport, scale),
      null,
    );
});
