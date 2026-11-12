import assert from "node:assert/strict";
import test from "node:test";
import {
  fuzzyFileMatch,
  recursiveFileSearch,
  relativeSearchPath,
  topLevelSelection,
} from "./recursiveSearch.ts";
const file = (path, isDir = false, extra = {}) => ({
  name: path.split(/[\\/]/).pop(),
  path,
  isDir,
  isSymlink: false,
  size: 12,
  modified: null,
  ...extra,
});
const options = (extra = {}) => ({
  root: "/root",
  rootEntries: [],
  side: "remote",
  query: "cfg",
  showHidden: false,
  signal: new AbortController().signal,
  list: async () => [],
  ...extra,
});
test("fuzzy search matches ordered characters, multiple words, case and Unicode", () => {
  assert.equal(fuzzyFileMatch("app/config.production.JSON", "cfg json"), true);
  assert.equal(fuzzyFileMatch("配置/服务器日志.log", "服日"), true);
  assert.equal(fuzzyFileMatch("app/🚀-config.json", "🚀cfg"), true);
  assert.equal(fuzzyFileMatch("config.json", "ｃｆｇ"), true);
  assert.equal(fuzzyFileMatch("config.json", "gfc"), false);
});
test("recursive results include relative paths, skip hidden trees and never follow symlinks", async () => {
  const calls = [];
  const result = await recursiveFileSearch(
    options({
      rootEntries: [
        file("/root/app", true),
        file("/root/.hidden", true),
        file("/root/link", true, { isSymlink: true }),
        file("/outside/config.json"),
      ],
      list: async (path) => {
        calls.push(path);
        return [file(`${path}/config.json`), file(`${path}/.config.json`)];
      },
    }),
  );
  assert.deepEqual(calls, ["/root/app"]);
  assert.deepEqual(
    result.entries.map((entry) => entry.path),
    ["/root/app/config.json"],
  );
  assert.equal(result.directories, 2);
  const hidden = await recursiveFileSearch(
    options({
      rootEntries: [file("/root/.hidden", true)],
      showHidden: true,
      list: async () => [file("/root/.hidden/config.json")],
    }),
  );
  assert.equal(hidden.entries.length, 1);
});
test("an unreadable directory reports partial results while sibling search continues", async () => {
  const result = await recursiveFileSearch(
    options({
      rootEntries: [file("/root/denied", true), file("/root/app", true)],
      list: async (path) => {
        if (path.endsWith("denied")) throw new Error("Permission denied");
        return [file(`${path}/config.json`)];
      },
    }),
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.error, "Permission denied");
  assert.equal(result.entries[0].path, "/root/app/config.json");
});

test("search depth bounds directory reads without dropping matches at the boundary", async () => {
  const children = new Map([
    ["/root/app", [file("/root/app/config.json"), file("/root/app/deep", true)]],
    ["/root/app/deep", [file("/root/app/deep/config.json")]],
  ]);
  for (const maxDepth of [0, 1, 2, null]) {
    const calls = [];
    const result = await recursiveFileSearch(options({
      maxDepth,
      rootEntries: [file("/root/config.json"), file("/root/app", true)],
      list: async (path) => {
        calls.push(path);
        return children.get(path) ?? [];
      },
    }));
    const visited = maxDepth ?? 2;
    assert.deepEqual(calls, [...children.keys()].slice(0, visited));
    assert.equal(result.entries.length, visited + 1);
    assert.equal(result.limited, false);
  }
});

test("search overlaps at most four directory reads and keeps breadth-first results", async () => {
  const rootEntries = Array.from({ length: 9 }, (_, i) => file(`/root/dir-${i}`, true));
  let active = 0;
  let peak = 0;
  const result = await recursiveFileSearch(options({
    rootEntries,
    list: async (path) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, path.endsWith("-0") ? 10 : 0));
      active -= 1;
      return [file(`${path}/config.json`)];
    },
  }));
  assert.equal(peak, 4);
  assert.deepEqual(result.entries.map((entry) => entry.path), rootEntries.map((entry) => `${entry.path}/config.json`));
});
test("cancellation during a listing ignores its response and stops further requests", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await recursiveFileSearch(
    options({
      signal: controller.signal,
      rootEntries: [file("/root/a", true), file("/root/b", true)],
      list: async (path) => {
        calls.push(path);
        controller.abort();
        return [file(`${path}/config.json`)];
      },
    }),
  );
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(calls, ["/root/a"]);
});
test("directory, entry and result budgets produce explicitly partial results", async () => {
  const directories = await recursiveFileSearch(
    options({
      rootEntries: [file("/root/a", true), file("/root/b", true)],
      limits: { directories: 1, entries: 100, results: 100 },
    }),
  );
  assert.equal(directories.limited, true);
  assert.equal(directories.directories, 1);
  for (const limits of [
    { directories: 10, entries: 1, results: 100 },
    { directories: 10, entries: 100, results: 1 },
  ]) {
    const result = await recursiveFileSearch(
      options({
        query: "txt",
        rootEntries: [file("/root/one.txt"), file("/root/two.txt")],
        limits,
      }),
    );
    assert.equal(result.limited, true);
    assert.equal(result.entries.length, 1);
  }
});
test("relative paths respect root boundaries, Windows drives and UNC directories", () => {
  assert.equal(
    relativeSearchPath("/root/app/config.json", "/root", "remote"),
    "app/config.json",
  );
  assert.equal(
    relativeSearchPath("/root-copy/config.json", "/root", "remote"),
    null,
  );
  assert.equal(relativeSearchPath("/root", "/root", "remote"), null);
  assert.equal(relativeSearchPath("/etc/config", "/", "remote"), "etc/config");
  assert.equal(
    relativeSearchPath("c:\\WORK\\app\\config.json", "C:\\work", "local"),
    "app/config.json",
  );
  assert.equal(
    relativeSearchPath("C:\\config.json", "C:\\", "local"),
    "config.json",
  );
  assert.equal(
    relativeSearchPath(
      "\\\\server\\share\\app\\config.json",
      "\\\\server\\share",
      "local",
    ),
    "app/config.json",
  );
});
test("batch operations omit descendants already covered by selected directories", () => {
  const parent = file("/root/app", true);
  const child = file("/root/app/config.json");
  const sibling = file("/root/app-copy/config.json");
  assert.deepEqual(
    topLevelSelection([child, parent, sibling, child], "remote"),
    [parent, sibling],
  );
  assert.deepEqual(
    topLevelSelection(
      [file("C:\\work\\app", true), file("c:\\WORK\\app\\config.json")],
      "local",
    ).map((entry) => entry.path),
    ["C:\\work\\app"],
  );
});

test("a large directory yields so a stop request can interrupt its scan", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    const result = await recursiveFileSearch(
      options({
        signal: controller.signal,
        rootEntries: Array.from({ length: 2000 }, (_, i) =>
          file(`/root/file-${i}.txt`),
        ),
        query: "unmatched",
      }),
    );
    assert.equal(result.cancelled, true);
    assert.ok(result.scanned > 0 && result.scanned < 2000);
  } finally {
    clearTimeout(timer);
  }
});
