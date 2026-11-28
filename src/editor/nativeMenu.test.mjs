import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeMenuModel } from './nativeMenu.ts';
test('native menus group existing commands, remove duplicate clipboard and guard actions', () => {
  let calls = 0;
  const groups = [{ id: 'edit', label: '编辑', items: [
    { id: 'undo', label: '撤销', run() { calls++; } },
    { id: 'editor.action.clipboardCopyAction', label: '复制', run() {} },
    { id: 'formatA', label: '粗体', section: '行内格式', run() {} },
    { id: 'formatB', label: '斜体', section: '行内格式', disabled: true, run() {} },
  ] }];
  const { menus, actions } = nativeMenuModel(groups, false);
  assert.equal(menus[0].children.length, 2);
  assert.equal(menus[0].children[1].children.length, 1);
  assert.equal(actions.size, 2); actions.get('edit/0/undo').run(); assert.equal(calls, 1);
  assert.equal(actions.has('edit/3/formatB'), false);
  const blocked = nativeMenuModel(groups, true);
  assert.deepEqual(blocked.menus, []); assert.equal(blocked.actions.size, 0);
});

test('native menus omit empty groups and sections, restoring original action ids when available', () => {
  const action = { id: 'format', label: '格式化', section: '行内格式', disabled: true, run() {} };
  const groups = [{ id: 'edit', label: '编辑', items: [action] }];
  assert.deepEqual(nativeMenuModel(groups, false).menus, []);
  action.disabled = false;
  const restored = nativeMenuModel(groups, false);
  assert.equal(restored.menus[0].children[0].children[0].id, 'edit/0/format');
  assert.equal(restored.actions.get('edit/0/format'), action);
});
