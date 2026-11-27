import { test } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { richMarkdownExtensions } from "./richMarkdownExtensions.ts";
import { RichMarkdownAdapter, markdownChange, richMarkdownPaste } from "./richMarkdown.ts";
const extensions = richMarkdownExtensions(), schema = getSchema(extensions), markdown = new MarkdownManager({ extensions });
function parse(source) { const adapter = new RichMarkdownAdapter(); return { adapter, doc: adapter.parse(source, markdown, node => schema.nodeFromJSON(node).toJSON()) }; }

test("rich markdown preserves exact untouched blocks, line breaks and protected syntax", () => {
  for (const source of ["# Heading\r\n\r\n__bold__\r\n", '---\ntitle: "x"\n---\n\nText\n\n<!-- comment -->\n\n[x]: /local\n\n[x][x]\n', "- [ ] A\n- [x] B\n\n```mermaid\nA-->B\n```\n", "| A | B |\n|---|---|\n| C | D |\n"]) {
    const { adapter, doc } = parse(source); assert.equal(adapter.serialize(doc, markdown), source);
  }
});

test("editing one block preserves other raw syntax and supports insertion and removal", () => {
  const source = "# Heading\n\n\nUntouched __bold__.\n\nChange me.\n\n<!-- keep -->\n";
  const { adapter, doc } = parse(source); doc.content[2].content[0].text = "Changed.";
  assert.equal(adapter.serialize(doc, markdown), source.replace("Change me.", "Changed."));
  doc.content.splice(2, 0, schema.nodeFromJSON({ type: "paragraph", content: [{ type: "text", text: "Inserted" }] }).toJSON());
  const changed = adapter.serialize(doc, markdown); assert.match(changed, /Inserted\n\nChanged/); assert.match(changed, /Untouched __bold__\./); assert.match(changed, /<!-- keep -->\n$/);
  doc.content.splice(0, 1); assert.ok(!adapter.serialize(doc, markdown).includes("Heading"));
});

test("unsupported references, HTML and custom syntax remain literal protected blocks", () => {
  const source = "[definition]: /target\n\n[label][definition]\n\n<script>alert(1)</script>\n\n$$\nx^2\n$$\n";
  const { doc } = parse(source); assert.ok(doc.content.every(node => node.type === "rawMarkdown"));
  assert.throws(() => parse("x".repeat(1024 * 1024 + 1)), /超过/);
});

test("minimal markdown replacements preserve Unicode surrogate pairs and reconstruct the source", () => {
  for (const [before, after] of [["A😀B", "A😃B"], ["Heading", "Heading 中文"], ["a\n\nb", "a\n\nc"], ["abc", ""], ["", "😀"]]) {
    const change = markdownChange(before, after);
    assert.equal(before.slice(0, change.start) + change.text + before.slice(change.oldEnd), after);
    assert.ok(!/[\uDC00-\uDFFF]/.test(before[change.start] ?? ""));
  }
});


test("fenced paste parses literal code without reusing document source identities", () => {
  const text = '```mermaid\ngraph TD\n  A[开始] --> B{登录?}\n```';
  const nodes = richMarkdownPaste(text, markdown, node => schema.nodeFromJSON(node).toJSON());
  assert.equal(nodes[0].type, "codeBlock");
  assert.equal(nodes[0].attrs.language, "mermaid");
  assert.equal(nodes[0].content[0].text, 'graph TD\n  A[开始] --> B{登录?}');
  assert.ok(!JSON.stringify(nodes).includes('sourceKey'));
  const { adapter, doc } = parse('# Keep\n'); doc.content.push(...nodes);
  const output = adapter.serialize(doc, markdown);
  assert.ok(output.includes(text)); assert.ok(output.startsWith('# Keep\n'));
});
