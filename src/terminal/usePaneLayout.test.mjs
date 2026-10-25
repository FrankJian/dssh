import assert from "node:assert/strict";
import test from "node:test";
import { balancePaneTree, paneSessionIds, prunePaneLayouts, splitPaneTree } from "./usePaneLayout.ts";

function shares(node, share = 1) {
  if (node.type === "leaf") return [share];
  return [
    ...shares(node.children[0], share * node.ratios[0]),
    ...shares(node.children[1], share * node.ratios[1]),
  ];
}

const leaf = (sessionId) => ({ type: "leaf", sessionId });
const split = (id, dir, first, second) => ({
  type: "split", id, dir, children: [first, second], ratios: [0.5, 0.5],
});

test("three panes receive equal space after splitting one half", () => {
  const tree = split("root", "v", split("nested", "v", leaf("a"), leaf("c")), leaf("b"));
  const balanced = balancePaneTree(tree);
  assert.deepEqual(balanced.ratios, [2 / 3, 1 / 3]);
  for (const share of shares(balanced)) assert.ok(Math.abs(share - 1 / 3) < 1e-12);
});

test("orthogonal splits do not change the other axis", () => {
  const tree = split(
    "root", "h",
    split("left", "v", leaf("a"), leaf("b")),
    split("right", "h", leaf("c"), leaf("d")),
  );
  const balanced = balancePaneTree(tree);
  assert.deepEqual(balanced.ratios, [1 / 3, 2 / 3]);
  assert.deepEqual(balanced.children[0].ratios, [0.5, 0.5]);
  assert.deepEqual(balanced.children[1].ratios, [0.5, 0.5]);
});

test("splitting horizontally keeps a manually resized vertical divider", () => {
  const tree = split("root", "v", leaf("a"), leaf("b"));
  tree.ratios = [0.7, 0.3];
  const next = splitPaneTree(tree, "a", split("new", "h", leaf("a"), leaf("c")));
  assert.deepEqual(next.ratios, [0.7, 0.3]);
  assert.deepEqual(next.children[0].ratios, [0.5, 0.5]);
});

test("closing a horizontal pane keeps the vertical divider height", () => {
  const root = split("root", "v", split("top", "h", leaf("a"), leaf("c")), leaf("b"));
  root.ratios = [0.7, 0.3];
  const [layout] = prunePaneLayouts([{
    tabSessionId: "a", focusedPaneId: "a", root,
  }], new Set(["c"]));
  assert.deepEqual(layout.root.ratios, [0.7, 0.3]);
});

test("more than four same-axis panes receive equal widths", () => {
  let tree = leaf("a");
  for (const sessionId of ["b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
    const target = paneSessionIds(tree)[0];
    tree = splitPaneTree(tree, target, split(sessionId, "h", leaf(target), leaf(sessionId)));
  }
  for (const share of shares(tree)) assert.ok(Math.abs(share - 0.1) < 1e-12);
});

test("newly created first split is never pruned when no session closed", () => {
  const layout = {
    tabSessionId: "a",
    focusedPaneId: "b",
    root: split("first", "h", leaf("a"), leaf("b")),
  };
  const layouts = [layout];
  assert.strictEqual(prunePaneLayouts(layouts, new Set()), layouts);
  assert.strictEqual(prunePaneLayouts(layouts, new Set(["unrelated"])), layouts);
  assert.deepEqual(paneSessionIds(prunePaneLayouts(layouts, new Set())[0]), ["a", "b"]);
});
