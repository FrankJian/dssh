import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEditorWindowClose, coordinateEditorWindowClose } from './closeWorkspace.ts';
function fixture() {
 const calls = []; let valid = true;
 const editor = id => ({ prepareClose: async () => { calls.push(`prepare:${id}`); return { documents: [] }; }, validClose: () => valid, validFrozenClose: () => valid, freeze: () => calls.push(`freeze:${id}`), thaw: () => calls.push(`thaw:${id}`) });
 const options = { editors: [editor('a'), editor('b')], allowed: () => true, confirmTerminals: async () => { calls.push('terminal-decision'); return true; }, commit: async () => calls.push('release') };
 return { calls, options, invalidate: () => valid = false };
}
test('a later cancellation or failed save cannot release earlier documents or terminate terminals', async () => {
 for (const failedSave of [false, true]) {
  const f = fixture(); f.options.editors[1].prepareClose = async () => { if (failedSave) throw new Error('save failed'); return null; };
  if (failedSave) await assert.rejects(coordinateEditorWindowClose(f.options), /save failed/); else assert.equal(await coordinateEditorWindowClose(f.options), false);
  assert.deepEqual(f.calls, ['prepare:a']);
 }
});
test('terminal cancellation and edits during its confirmation invalidate the entire window close', async () => {
 for (const changed of [false, true]) {
  const f = fixture(); f.options.confirmTerminals = async () => { f.calls.push('terminal-decision'); if (changed) f.invalidate(); return changed; };
  assert.equal(await coordinateEditorWindowClose(f.options), false); assert.deepEqual(f.calls, ['prepare:a', 'prepare:b', 'terminal-decision']);
 }
});
test('all decisions precede freeze and release; failures thaw every retained editor', async () => {
 const f = fixture(); f.options.commit = async () => { f.calls.push('release-failed'); throw new Error('injected release failure'); };
 await assert.rejects(coordinateEditorWindowClose(f.options));
 assert.deepEqual(f.calls, ['prepare:a', 'prepare:b', 'terminal-decision', 'freeze:a', 'freeze:b', 'release-failed', 'thaw:a', 'thaw:b']);
});

test('application quit can prepare multiple windows and cancel all without releasing resources', async () => {
 const first = fixture(); const second = fixture();
 const a = await prepareEditorWindowClose(first.options);
 second.options.confirmTerminals = async () => false;
 assert.equal(await prepareEditorWindowClose(second.options), null);
 assert.equal(a.valid(), true); a.cancel(); a.cancel();
 assert.equal(a.valid(), false);
 assert.equal(first.calls.includes('release'), false); assert.equal(second.calls.includes('release'), false);
 assert.deepEqual(first.calls.slice(-2), ['thaw:a', 'thaw:b']);
});
test('prepared quit rechecks frozen document decisions and application lock before commit', async () => {
 const f = fixture(); let allowed = true; f.options.allowed = () => allowed;
 const prepared = await prepareEditorWindowClose(f.options);
 assert.equal(prepared.valid(), true); allowed = false; assert.equal(prepared.valid(), false);
 allowed = true; f.invalidate(); assert.equal(prepared.valid(), false); prepared.cancel();
 assert.equal(f.calls.includes('release'), false);
});
