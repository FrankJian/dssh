import assert from "node:assert/strict";
import { test } from "node:test";

const values = new Map();
const storageListeners = new Set();
let failWrites = false;
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    if (failWrites) throw new Error("storage full");
    values.set(key, value);
  },
};
globalThis.window = { addEventListener: (name, listener) => {
  if (name === "storage") storageListeners.add(listener);
} };
const store = await import("./terminalCursorStore.ts");
const sync = (key = store.terminalCursorStorageKey) => {
  for (const listener of storageListeners) listener({ key });
};

test("missing and malformed settings retain the existing blinking bar default", async () => {
  assert.deepEqual(store.getTerminalCursorPreferences(), { cursorStyle: "bar", cursorBlink: true });
  for (const value of [null, [], { cursorStyle: "beam", cursorBlink: "false" }]) {
    assert.deepEqual(store.normalizeTerminalCursorPreferences(value), { cursorStyle: "bar", cursorBlink: true });
  }
  values.set(store.terminalCursorStorageKey, "{broken");
  const malformed = await import("./terminalCursorStore.ts?malformed");
  assert.deepEqual(malformed.getTerminalCursorPreferences(), { cursorStyle: "bar", cursorBlink: true });
  values.clear();
});

test("all four shapes persist with blinking on and off and survive reload", async () => {
  for (const cursorStyle of ["underline", "thick-underline", "block", "bar"]) {
    for (const cursorBlink of [false, true]) {
      const expected = { cursorStyle, cursorBlink };
      store.setTerminalCursorPreferences(expected);
      assert.deepEqual(JSON.parse(values.get(store.terminalCursorStorageKey)), expected);
      const reloaded = await import(`./terminalCursorStore.ts?${cursorStyle}-${cursorBlink}`);
      assert.deepEqual(reloaded.getTerminalCursorPreferences(), expected);
    }
  }
});

test("thick underline maps to a native underline while retaining its saved style", () => {
  for (const cursorBlink of [false, true]) {
    const preferences = { cursorStyle: "thick-underline", cursorBlink };
    assert.deepEqual(store.getTerminalCursorOptions(preferences), { cursorStyle: "underline", cursorBlink });
    assert.equal(preferences.cursorStyle, "thick-underline");
  }
});

test("storage sync updates live subscribers and merges changes from other windows", () => {
  let notifications = 0;
  const unsubscribe = store.subscribeTerminalCursorPreferences(() => notifications++);
  values.set(store.terminalCursorStorageKey, JSON.stringify({ cursorStyle: "underline", cursorBlink: false }));
  sync();
  assert.deepEqual(store.getTerminalCursorPreferences(), { cursorStyle: "underline", cursorBlink: false });
  assert.equal(notifications, 1);
  const snapshot = store.getTerminalCursorPreferences();
  sync();
  assert.equal(store.getTerminalCursorPreferences(), snapshot);
  assert.equal(notifications, 1);
  // A different window saved a new shape before its event reached this one.
  values.set(store.terminalCursorStorageKey, JSON.stringify({ cursorStyle: "block", cursorBlink: false }));
  store.setTerminalCursorPreferences({ cursorBlink: true });
  assert.deepEqual(store.getTerminalCursorPreferences(), { cursorStyle: "block", cursorBlink: true });
  values.clear();
  sync(null);
  assert.deepEqual(store.getTerminalCursorPreferences(), { cursorStyle: "bar", cursorBlink: true });
  unsubscribe();
});

test("failed persistence leaves the current cursor unchanged", () => {
  const before = store.getTerminalCursorPreferences();
  failWrites = true;
  assert.throws(() => store.setTerminalCursorPreferences({ cursorStyle: "block" }), /保存终端光标设置失败/);
  assert.equal(store.getTerminalCursorPreferences(), before);
  failWrites = false;
});
