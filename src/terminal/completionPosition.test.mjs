import assert from "node:assert/strict";
import { test } from "node:test";
import { placeCompletionMenu } from "./completionPosition.ts";

const bounds = { left: 100, top: 60, right: 500, bottom: 300 };

test("completion stays inside the viewport near its bottom and right edges", () => {
  const popup = placeCompletionMenu(bounds, 480, 270, 290, 300, 20, 24);
  assert.deepEqual(popup, { left: 196, top: 116, width: 300, height: 150 });
  assert.ok(popup.left >= bounds.left && popup.left + popup.width <= bounds.right);
  assert.ok(popup.top >= bounds.top && popup.top + popup.height <= bounds.bottom);
});

test("completion moves below a top prompt and reduces visible rows when space is tight", () => {
  const top = placeCompletionMenu(bounds, 140, 65, 85, 140, 10, 24);
  assert.deepEqual(top, { left: 140, top: 89, width: 140, height: 150 });

  const short = placeCompletionMenu({ left: 0, top: 0, right: 180, bottom: 100 }, 160, 50, 70, 300, 10, 24);
  assert.deepEqual(short, { left: 4, top: 16, width: 172, height: 30 });
});

test("completion hides when not even one whole row fits", () => {
  assert.equal(placeCompletionMenu({ left: 0, top: 0, right: 100, bottom: 50 }, 10, 15, 35, 100, 10, 24), null);
});
