import test from "node:test";
import assert from "node:assert/strict";
import { searchText } from "./searchMatch.ts";
const query = (pattern, extra = {}) => ({ pattern, regex: false, caseSensitive: false, wholeWord: false, ...extra });
test("search positions use UTF-16 columns across Chinese, surrogate pairs and CRLF", () => {
 const result = searchText("中文😀a\r\n😀a", query("a"));
 assert.deepEqual(result.matches.map((m) => [m.line, m.column, m.endColumn]), [[1,5,6],[2,3,4]]);
});
test("literal, case, whole-word and invalid regex preserve text", () => {
 assert.equal(searchText("a.b A.b axb", query("a.b")).matches.length, 2);
 assert.equal(searchText("a.b A.b axb", query("a.b", { caseSensitive: true })).matches.length, 1);
 assert.equal(searchText("中文 文 字文", query("文", { wholeWord: true })).matches.length, 1);
 assert.throws(() => searchText("text", query("[", { regex: true }))); assert.throws(() => searchText("text", query("")));
});
test("JS replacement tokens, captures, named groups and escaped dollars are interpreted once", () => {
 const value = searchText("a1 b2", query("(?<letter>[a-z])(\\d)", { regex: true, replacement: "$$:$<letter>:$2:$&" }));
 assert.equal(value.content, "$:a:1:a1 $:b:2:b2");
 assert.equal(searchText("abc", query("b", { regex: true, replacement: "$`-$'" })).content, "aa-cc");
});
test("zero-length matches terminate on surrogate pairs and truncation cannot create a replacement body", () => {
 assert.equal(searchText("😀", query("(?:)", { regex: true })).matches.length, 2);
 const result = searchText("aaaa", query("a", { replacement: "b" }), 2);
 assert.equal(result.matches.length, 2); assert.equal(result.truncated, true); assert.equal(result.content, undefined);
});
