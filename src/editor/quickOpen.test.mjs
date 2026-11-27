import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyPathScore, quickOpenMatches } from "./quickOpen.ts";
test("quick-open ranks basename prefixes and ordered path subsequences without regex interpretation", () => {
 const items = ["src/foo.ts", "src/fileProvider.ts", "foo/bar.ts", "src/other.ts"].map((path) => ({ path: `/${path}`, relativePath: path }));
 assert.equal(quickOpenMatches(items, "foo")[0].relativePath, "src/foo.ts");
 assert.deepEqual(quickOpenMatches(items, "fpr").map((item) => item.relativePath), ["src/fileProvider.ts"]);
 assert.equal(fuzzyPathScore("src/a.ts", "["), null); assert.equal(quickOpenMatches(items, "no match").length, 0);
});
test("quick-open results and query inputs are bounded", () => {
 const items = Array.from({ length: 120 }, (_, index) => ({ path: `/${index}`, relativePath: `${index}` }));
 assert.equal(quickOpenMatches(items, "").length, 100); assert.throws(() => quickOpenMatches(items, "a".repeat(257)));
});
