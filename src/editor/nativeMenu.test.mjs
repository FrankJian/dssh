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
  assert.equal(menus[0].children[1].children.length, 2);
  assert.equal(menus[0].children[1].children[1].enabled, false);
  assert.equal(actions.size, 3); actions.get('edit/0/undo').run(); assert.equal(calls, 1);
  const blocked = nativeMenuModel(groups, true).menus[0].children;
  assert.equal(blocked[0].enabled, false); assert.ok(blocked[1].children.every(item => !item.enabled));
});
