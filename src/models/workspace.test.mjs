import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceSessionIds } from './workspace.ts';

test('new workbench sessions replace the original detached terminal ownership', () => {
  assert.deepEqual(workspaceSessionIds({ terminal: { sessionIds: ['original'] }, workbench: { sessionIds: ['replacement', 'new-ssh', 'split-pane'] } }), ['replacement', 'new-ssh', 'split-pane']);
});

test('closing the last terminal never revives the original detached session', () => {
  assert.deepEqual(workspaceSessionIds({ terminal: { sessionIds: ['original'] }, workbench: { sessionIds: [] } }), []);
});

test('initial terminal and SFTP windows retain their ownership before hydration', () => {
  assert.deepEqual(workspaceSessionIds({ terminal: { sessionIds: ['left', 'right'] } }), ['left', 'right']);
  assert.deepEqual(workspaceSessionIds({ sftp: { profileId: 'profile' } }), []);
});
