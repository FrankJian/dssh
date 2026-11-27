import test from 'node:test';
import assert from 'node:assert/strict';
import { transferEditorWorkspace } from './transferWorkspace.ts';
function fixture() {
  const calls = []; const state = { layout: { kind: 'group', id: 'main', documents: ['/root/a'], active: '/root/a', preview: null }, focused: 'main', locations: {} };
  let allowed = true; let valid = true;
  const handle = { prepareClose: async () => ({ documents: [] }), validClose: () => valid, snapshot: () => state, freeze: () => calls.push('freeze'), thaw: () => calls.push('thaw'), validFrozenClose: () => valid };
  const source = { workspace: { id: 'opaque', source: { kind: 'sftp', profileId: 'saved-profile' }, rootPath: '/root', initialFile: null }, title: 'editor' };
  const io = { allowed: () => allowed, start: async (id, reference) => { calls.push('start'); assert.equal(id, 'opaque'); assert.equal(reference.source, source.workspace.source); assert.equal('content' in reference, false); return { workspace: { label: 'target' }, handoffId: 'handoff' }; }, opened: () => calls.push('opened'), wait: async () => { calls.push('ready'); return true; }, finish: async (_, commit) => calls.push(commit ? 'commit' : 'abort') };
  return { calls, handle, source, io, setAllowed: (value) => allowed = value, setValid: (value) => valid = value };
}
test('window creation and acknowledgement precede source release; cancellation creates no window', async () => {
  const f = fixture(); assert.equal(await transferEditorWorkspace(f.source, f.handle, f.io), true); assert.deepEqual(f.calls, ['freeze', 'start', 'opened', 'ready', 'commit']);
  const cancelled = fixture(); cancelled.handle.prepareClose = async () => null; assert.equal(await transferEditorWorkspace(cancelled.source, cancelled.handle, cancelled.io), false); assert.deepEqual(cancelled.calls, []);
});
test('initialization failure, changed revision, lock and failed commit abort and thaw the source', async () => {
  for (const mode of ['load', 'revision', 'lock', 'commit']) {
    const f = fixture();
    f.io.wait = async () => { if (mode === 'revision') f.setValid(false); if (mode === 'lock') f.setAllowed(false); return mode !== 'load'; };
    if (mode === 'commit') f.io.finish = async (_, commit) => { f.calls.push(commit ? 'commit-failed' : 'abort'); if (commit) throw new Error('injected commit failure'); };
    await assert.rejects(transferEditorWorkspace(f.source, f.handle, f.io)); assert.deepEqual(f.calls.slice(-2), ['abort', 'thaw']);
  }
});
