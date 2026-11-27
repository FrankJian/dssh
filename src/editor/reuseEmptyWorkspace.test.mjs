import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reuseEmptyEditorWorkspace } from './reuseEmptyWorkspace.ts';
const blank = id => ({ id: `editor:${id}`, title: '文本编辑器', workspace: { id, source: { kind: 'local' }, rootPath: null, initialFile: null } });
const workspace = { id: 'directory', source: { kind: 'sftp', profileId: 'synthetic' }, rootPath: '/project', initialFile: null };

test('reuse prefers its origin, skips occupied workspaces and returns the old backend identity', () => {
  const tabs = [blank('first'), { ...blank('folder'), workspace: { ...blank('folder').workspace, rootPath: '/existing' } }, blank('origin')];
  const calls = [];
  const handles = new Map(tabs.map(t => [t.id, { claimEmpty: () => { calls.push(t.id); return true; }, thaw: () => assert.fail('successful claim must stay frozen') }]));
  let replacement;
  const reused = reuseEmptyEditorWorkspace({ tabs, preferredId: 'editor:origin', handles, workspace, titleFor: () => 'project', replace: (...args) => { replacement = args; return true; } });
  assert.deepEqual(reused, { id: 'editor:origin', previousWorkspaceId: 'origin' });
  assert.deepEqual(calls, ['editor:origin']); assert.equal(replacement[0], 'editor:origin'); assert.equal(replacement[1], 'origin'); assert.equal(replacement[2], workspace);
});

test('failed or stale claims do not replace content and restore the losing empty handle', () => {
  const tabs = [blank('content'), blank('stale'), blank('fresh')]; const calls = [];
  const handles = new Map(tabs.map(t => [t.id, { claimEmpty: () => { calls.push(`claim:${t.id}`); return t.id !== 'editor:content'; }, thaw: () => calls.push(`thaw:${t.id}`) }]));
  const reused = reuseEmptyEditorWorkspace({ tabs, handles, workspace, titleFor: () => 'project', replace: id => id === 'editor:fresh' });
  assert.equal(reused.id, 'editor:fresh'); assert.deepEqual(calls, ['claim:editor:content', 'claim:editor:stale', 'thaw:editor:stale', 'claim:editor:fresh']);
  assert.equal(reuseEmptyEditorWorkspace({ tabs, handles, workspace: { ...workspace, rootPath: null }, titleFor: () => '', replace: () => assert.fail('single file must not use directory reuse') }), null);
});

test('a failed replacement unfreezes its claim rather than leaving an unusable blank tab', () => {
  let thawed = false; const tab = blank('one');
  assert.throws(() => reuseEmptyEditorWorkspace({ tabs: [tab], handles: new Map([[tab.id, { claimEmpty: () => true, thaw: () => { thawed = true; } }]]), workspace, titleFor: () => 'project', replace: () => { throw new Error('synthetic replacement failure'); } }), /synthetic/);
  assert.equal(thawed, true);
});
