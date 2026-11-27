import test from "node:test";
import assert from "node:assert/strict";
import { emptyGroup, openGroupDocument, splitEditorGroup, editorGroups, moveGroupDocument, removeEditorGroup, closeGroupDocument, resizeEditorSplit } from "./groupLayout.ts";

test("preview replaces only a clean preview and never drops a modified document", () => {
  let group = openGroupDocument(emptyGroup("one"), "a", true, () => false);
  group = openGroupDocument(group, "b", true, () => true);
  assert.deepEqual(group.documents, ["a", "b"]);
  group = openGroupDocument(group, "c", true, () => false);
  assert.deepEqual(group.documents, ["a", "c"]);
  assert.equal(openGroupDocument(group, "c", false, () => false).preview, null);
});
test("nested editor splits preserve earlier ratios and share active document views", () => {
  let layout = openGroupDocument(emptyGroup("one"), "a", false, () => false);
  layout = splitEditorGroup(layout, "one", "horizontal", "two", "split1");
  layout = resizeEditorSplit(layout, "split1", 0.7);
  layout = splitEditorGroup(layout, "two", "vertical", "three", "split2");
  assert.equal(layout.ratio, 0.7); assert.deepEqual(editorGroups(layout).map((group) => group.documents), [["a"], ["a"], ["a"]]);
  assert.equal(resizeEditorSplit(layout, "split1", 8).ratio, 0.9);
});
test("dragging moves or copies views, reorders tabs and collapses removed groups", () => {
  let layout = openGroupDocument(emptyGroup("one"), "a", false, () => false);
  layout = openGroupDocument(layout, "b", false, () => false);
  layout = splitEditorGroup(layout, "one", "horizontal", "two", "split");
  layout = moveGroupDocument(layout, "a", "one", "two", true, "b");
  assert.deepEqual(editorGroups(layout)[1].documents, ["a", "b"]);
  layout = moveGroupDocument(layout, "b", "one", "two", false);
  assert.deepEqual(editorGroups(layout)[0].documents, ["a"]);
  assert.equal(removeEditorGroup(layout, "two").id, "one");
  assert.equal(closeGroupDocument(editorGroups(layout)[0], "a").active, null);
});
