import assert from 'node:assert/strict';
import { test } from 'node:test';

const values = new Map();
const storageListeners = new Set();
let failWrites = false;
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => {
    if (failWrites) throw new Error('storage full');
    values.set(key, value);
  },
};
globalThis.window = { addEventListener: (type, listener) => {
  if (type === 'storage') storageListeners.add(listener);
} };
const store = await import('./terminalSuperKeyStore.ts');
const sync = (key = store.terminalSuperKeyStorageKey) => {
  for (const listener of storageListeners) listener({ key });
};

test('super key is visible by default and malformed values retain that default', () => {
  assert.equal(store.getTerminalSuperKeyVisible(), true);
  for (const value of ['', 'broken', 'null', '{}', '0', 'true']) {
    values.set(store.terminalSuperKeyStorageKey, value);
    sync();
    assert.equal(store.getTerminalSuperKeyVisible(), true);
  }
});

test('visibility persists across reload and publishes to current and other window subscribers', async () => {
  let notifications = 0;
  const unsubscribe = store.subscribeTerminalSuperKey(() => notifications++);
  store.setTerminalSuperKeyVisible(false);
  assert.equal(values.get(store.terminalSuperKeyStorageKey), 'false');
  assert.equal(store.getTerminalSuperKeyVisible(), false);
  assert.equal(notifications, 1);
  const reloaded = await import('./terminalSuperKeyStore.ts?reload');
  assert.equal(reloaded.getTerminalSuperKeyVisible(), false);
  values.set(store.terminalSuperKeyStorageKey, 'true');
  sync('unrelated');
  assert.equal(store.getTerminalSuperKeyVisible(), false);
  sync();
  assert.equal(store.getTerminalSuperKeyVisible(), true);
  assert.equal(reloaded.getTerminalSuperKeyVisible(), true);
  assert.equal(notifications, 2);
  sync();
  assert.equal(notifications, 2);
  store.setTerminalSuperKeyVisible(false);
  values.clear();
  sync(null);
  assert.equal(store.getTerminalSuperKeyVisible(), true);
  unsubscribe();
});

test('failed persistence preserves the visible state and emits no update', () => {
  let notifications = 0;
  const unsubscribe = store.subscribeTerminalSuperKey(() => notifications++);
  failWrites = true;
  assert.throws(() => store.setTerminalSuperKeyVisible(false), /保存终端超级键设置失败/);
  assert.equal(store.getTerminalSuperKeyVisible(), true);
  assert.equal(notifications, 0);
  failWrites = false;
  unsubscribe();
});
