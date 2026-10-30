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

test("completion can grow beyond the former fixed popup width", () => {
  const popup = placeCompletionMenu({ left: 0, top: 0, right: 1000, bottom: 300 }, 20, 100, 120, 760, 1, 24);
  assert.equal(popup.width, 760);
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

test("horizontal scrollbar space is reserved when reducing rows below the input", () => {
  const popup = placeCompletionMenu({ left: 0, top: 0, right: 300, bottom: 400 }, 10, 250, 274, 700, 5, 24, 8);
  assert.equal(popup.top, 278);
  assert.equal(popup.height, 110);
  assert.equal((popup.height - 6 - 8) / 24, 4);
  assert.ok(popup.left + popup.width <= 300);
});

test("completion prefers below even when all six rows fit above as well", () => {
  const popup = placeCompletionMenu({ left: 0, top: 0, right: 800, bottom: 600 }, 150, 250, 278, 300, 12, 28);
  assert.deepEqual(popup, { left: 150, top: 282, width: 300, height: 174 });
});

test("one complete row below is preferred over six rows above", () => {
  const popup = placeCompletionMenu({ left: 0, top: 0, right: 800, bottom: 400 }, 150, 330, 358, 300, 12, 28);
  assert.deepEqual(popup, { left: 150, top: 362, width: 300, height: 34 });
});

test("completion falls back above only when a complete row cannot fit below", () => {
  const popup = placeCompletionMenu({ left: 0, top: 0, right: 800, bottom: 400 }, 150, 340, 368, 300, 12, 28);
  assert.deepEqual(popup, { left: 150, top: 162, width: 300, height: 174 });
});
