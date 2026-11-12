import test from 'node:test';
import assert from 'node:assert/strict';
import { findSftpTerminal } from './sftpTerminal.ts';
const session = (id, profileId, status = 'connected', kind = 'ssh') => ({ id, profileId, status, kind, title: id });

test('standalone SFTP never targets an unrelated remote or local terminal', () => {
  assert.equal(findSftpTerminal([], 'files', null), undefined);
  assert.equal(findSftpTerminal([session('remote', 'other'), session('local', 'files', 'connected', 'local')], 'files', 'remote'), undefined);
});

test('terminal navigation prefers the active matching host and skips disconnected shells', () => {
  const sessions = [session('one', 'files'), session('two', 'files'), session('retry', 'files', 'reconnecting'), session('other', 'other')];
  assert.equal(findSftpTerminal(sessions, 'files', 'two').id, 'two');
  assert.equal(findSftpTerminal(sessions, 'files', 'other').id, 'one');
  assert.equal(findSftpTerminal(sessions, 'files', 'retry').id, 'one');
  assert.equal(findSftpTerminal([session('closed', 'files', 'exited')], 'files', 'closed'), undefined);
});

test('switching from SFTP reuses a pending matching shell without offering shell commands', () => {
  const sessions = [session('pending', 'files', 'connecting'), session('retry', 'files', 'reconnecting'), session('other', 'other')];
  assert.equal(findSftpTerminal(sessions, 'files', 'pending'), undefined);
  assert.equal(findSftpTerminal(sessions, 'files', 'pending', { includePending: true }).id, 'pending');
  assert.equal(findSftpTerminal(sessions, 'files', 'retry', { includePending: true }).id, 'retry');
  assert.equal(findSftpTerminal([session('failed', 'files', 'failed')], 'files', null, { includePending: true }), undefined);
});
