import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEditorFile, editorRestoreRequest, parseEditorWorkspaceReference, mapEditorLayout, parseEditorLayoutReference, readEditorWorkspaceReferences, storeEditorFolderLayout, readEditorFolderLayout } from './layoutReferences.ts';
const layout = { kind: 'group', id: 'main', documents: ['dirty', 'clean', 'untitled'], active: 'dirty', preview: 'clean' };
test('legacy rootless remote references restore clean files instead of checking the home directory as a file', () => {
  const source = { kind: 'sftp', profileId: 'fixture' };
  for (const path of ['/home/test/a.txt', '/home/test/b.txt', '/home/test/c.txt']) {
    const state = { layout: { kind: 'group', id: 'main', documents: [path], active: path, preview: null }, focused: 'main', locations: {} };
    assert.equal(initialEditorFile(state), path);
    assert.deepEqual(editorRestoreRequest({ source, rootPath: null, initialFile: null, title: 'legacy', state }), { source, path, directory: false });
    assert.deepEqual(editorRestoreRequest({ source, rootPath: '/home/test', initialFile: null, title: 'folder', state }), { source, path: '/home/test', directory: true });
    const empty = { ...state, layout: { ...state.layout, documents: [], active: null } };
    assert.equal(initialEditorFile(empty), null);
    assert.deepEqual(editorRestoreRequest({ source, rootPath: null, initialFile: null, title: 'empty', state: empty }), { source, path: undefined, directory: false });
  }
});
test('references map only authorized file identities and whitelist storage fields', () => {
  const saved = mapEditorLayout(layout, id => id === 'clean' ? '/root/clean' : null);
  const reference = parseEditorWorkspaceReference({ source: { kind: 'sftp', profileId: 'profile', password: 'synthetic-unwanted' }, rootPath: '/root', initialFile: null, title: 'editor', content: 'synthetic-body', state: { layout: saved, focused: 'main', locations: { main: { path: '/root/clean', line: 12, column: 2, scrollTop: 100, scrollLeft: 0, content: 'synthetic-body' } } } });
  assert.deepEqual(reference.state.layout.documents, ['/root/clean']);
  assert.equal(reference.state.locations.main.line, 12);
  assert.equal(JSON.stringify(reference).includes('synthetic'), false);
  assert.deepEqual(readEditorWorkspaceReferences({ getItem: () => '{broken' }), []);
});
test('corrupt, duplicate and unbounded layout references are rejected', () => {
  assert.equal(parseEditorLayoutReference({ layout, focused: 'missing' }).focused, 'main');
  assert.equal(parseEditorLayoutReference({ layout: { ...layout, documents: Array(101).fill(0).map((_, n) => String(n)) } }), null);
  assert.equal(parseEditorLayoutReference({ layout: { kind: 'split', id: 'split', direction: 'vertical', children: [layout, layout] } }), null);
  assert.equal(parseEditorWorkspaceReference({ source: { kind: 'arbitrary' } }), null);
});

test('independent folder caches preserve opaque source identity and contain only references', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const reference = { source: { kind: 'sftp', profileId: 'host-a' }, rootPath: '/root', initialFile: null, title: 'folder', state: { layout: { ...layout, documents: ['/root/clean'], active: '/root/clean', preview: null }, focused: 'main', locations: {} } };
  storeEditorFolderLayout(storage, reference);
  assert.deepEqual(readEditorFolderLayout(storage, reference.source, '/root'), reference);
  assert.equal(readEditorFolderLayout(storage, { kind: 'sftp', profileId: 'host-b' }, '/root'), null);
  assert.equal(readEditorFolderLayout(storage, reference.source, '/Root'), null);
  assert.equal(readEditorFolderLayout(storage, { kind: 'local' }, '/root'), null);
});
