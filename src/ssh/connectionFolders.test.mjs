import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConnectionFolder, buildConnectionFolders, isInConnectionFolder } from './connectionFolders.ts';

test('normalizes virtual paths with Windows separators, whitespace and empty segments', () => {
  assert.equal(normalizeConnectionFolder(' / a // b \\ c / '), 'a/b/c');
  assert.equal(normalizeConnectionFolder('/生产/应用/'), '生产/应用');
  assert.equal(normalizeConnectionFolder(''), '');
  for (const value of ['a/../b', 'a/./b', 'a\nb', 'a/'.repeat(33), 'a'.repeat(1025), '中'.repeat(342)]) {
    assert.throws(() => normalizeConnectionFolder(value));
  }
});

test('builds sorted ancestor nodes and counts each connection exactly once per ancestor', () => {
  const nodes = buildConnectionFolders([
    { folder: 'a/b/c' }, { folder: 'a/b' }, { folder: 'a/d' }, { folder: 'a/b/c' },
    { folder: 'ab/c' }, { folder: '' }, {},
  ]);
  assert.deepEqual(nodes, [
    { name: 'a', path: 'a', count: 4, children: [
      { name: 'b', path: 'a/b', count: 3, children: [
        { name: 'c', path: 'a/b/c', count: 2, children: [] },
      ] }, { name: 'd', path: 'a/d', count: 1, children: [] },
    ] },
    { name: 'ab', path: 'ab', count: 1, children: [{ name: 'c', path: 'ab/c', count: 1, children: [] }] },
  ]);
});

test('a selected directory includes descendants and excludes sibling prefixes and root', () => {
  assert.equal(isInConnectionFolder({ folder: 'a/b' }, 'a/b'), true);
  assert.equal(isInConnectionFolder({ folder: 'a/b/c' }, 'a/b'), true);
  assert.equal(isInConnectionFolder({ folder: 'a/bb/c' }, 'a/b'), false);
  assert.equal(isInConnectionFolder({ folder: 'ab/c' }, 'a'), false);
  assert.equal(isInConnectionFolder({}, 'a'), false);
  assert.deepEqual(buildConnectionFolders([{}, { folder: '' }]), []);
});

test('directory renaming only changes the selected leaf and preserves the parent', async () => {
  const { renamedConnectionFolderPath } = await import('./connectionFolders.ts');
  assert.equal(renamedConnectionFolderPath('a/b/c', ' new '), 'a/b/new');
  assert.equal(renamedConnectionFolderPath('home', 'servers'), 'servers');
  for (const value of ['', ' ', '/', 'a/b', 'a\\b', '.', '..', 'bad\nname']) {
    assert.throws(() => renamedConnectionFolderPath('a/b', value));
  }
});
