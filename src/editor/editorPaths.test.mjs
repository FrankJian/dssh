import test from 'node:test';
import assert from 'node:assert/strict';
import { editorBaseName, editorParentPath, editorWithinRoot, canReuseEditorWorkspace } from './editorPaths.ts';
test('editor navigation preserves literal POSIX backslashes, Windows roots and path component boundaries', () => {
 const local = { kind: 'local' }; const remote = { kind: 'sftp', profileId: 'host' };
 assert.equal(editorBaseName(remote, '/root/f\\name.ts'), 'f\\name.ts'); assert.equal(editorBaseName(local, '/tmp/f\\name.ts'), 'f\\name.ts');
 assert.equal(editorBaseName(local, 'C:\\root\\name.ts'), 'name.ts'); assert.equal(editorParentPath(remote, '/root/f\\name.ts'), '/root');
 assert.equal(editorWithinRoot(remote, '/root\\literal/file', '/root\\literal'), true); assert.equal(editorWithinRoot(remote, '/root/other', '/root\\literal'), false);
 assert.equal(editorWithinRoot(local, 'C:/root/name.ts', 'C:\\root'), true); assert.equal(editorWithinRoot(local, '\\\\server\\share\\name.ts', '\\\\server\\share\\'), true);
 assert.equal(editorWithinRoot(remote, '/rootish/file', '/root'), false); assert.equal(editorWithinRoot(remote, '/Root/file', '/root'), false);
});

test('session directory context never reuses a folderless file or another source workspace', () => {
 const source = { kind: 'sftp', profileId: 'host' }; const path = '/root/nested/file.txt';
 const standalone = { id: 'one', source, rootPath: null, initialFile: path };
 assert.equal(canReuseEditorWorkspace(standalone, source, path), true);
 assert.equal(canReuseEditorWorkspace(standalone, source, path, '/root'), false);
 const folder = { ...standalone, rootPath: '/root', initialFile: null };
 assert.equal(canReuseEditorWorkspace(folder, source, path, '/root'), true);
 assert.equal(canReuseEditorWorkspace(folder, source, path, '/root/nested'), false);
 assert.equal(canReuseEditorWorkspace(folder, { kind: 'sftp', profileId: 'other' }, path, '/root'), false);
 assert.equal(canReuseEditorWorkspace(folder, { kind: 'local' }, path, '/root'), false);
 assert.equal(canReuseEditorWorkspace(folder, source, '/rootish/file.txt', '/root'), false);
});
