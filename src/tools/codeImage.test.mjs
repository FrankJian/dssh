import assert from "node:assert/strict";
import test from "node:test";

import { colorCodeRow } from "./codeImage.ts";
import { layoutImageRows } from "./textImage.ts";

test("code image layout reserves space and maps wrapped segments to source lines", () => {
  const suffix = "🚀suffix";
  const input = "\t" + "a".repeat(89) + suffix + "\r\n\r\ntail\n";
  const layout = layoutImageRows(input, (text) => [...text].length * 10, { gutter: 46, header: 42 });
  assert.equal(layout.width, 1024);
  assert.equal(layout.height, 210);
  assert.deepEqual(layout.rows, [
    { text: "    " + "a".repeat(89), sourceIndex: 0, offset: 0 },
    { text: suffix, sourceIndex: 0, offset: 93 },
    { text: "", sourceIndex: 1, offset: 0 },
    { text: "tail", sourceIndex: 2, offset: 0 },
    { text: "", sourceIndex: 3, offset: 0 },
  ]);
  assert.throws(() => layoutImageRows(Array(168).fill("a").join("\n"), () => 10, { header: 42 }), /4096/);
});

test("highlight colors continue on wrapped rows without changing the source text", () => {
  const tokens = [
    { offset: 0, type: "keyword.js" },
    { offset: 3, type: "" },
    { offset: 8, type: "string.quote.js" },
    { offset: 9, type: "string.js" },
    { offset: 17, type: "number.js" },
  ];
  const first = colorCodeRow({ text: 'let x = "lo', sourceIndex: 0, offset: 0 }, tokens, 0);
  assert.deepEqual(first.spans, [
    { text: "let", color: "keyword" },
    { text: " x = ", color: "text" },
    { text: '"lo', color: "string" },
  ]);
  const tail = colorCodeRow({ text: 'ng" + 42', sourceIndex: 0, offset: 11 }, tokens, first.nextTokenIndex);
  assert.deepEqual(tail.spans, [
    { text: 'ng" + ', color: "string" },
    { text: "42", color: "number" },
  ]);
  assert.deepEqual(colorCodeRow({ text: "内容", sourceIndex: 0, offset: 0 }, [], 0).spans, [
    { text: "内容", color: "text" },
  ]);
});
