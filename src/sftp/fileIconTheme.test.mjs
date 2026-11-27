import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTypeIcon } from './fileIconTheme.ts';

test('Seti recognizes the requested language and special-file families', () => {
  const cases = {
    '.gitignore': '_git', '.gitattributes': '_git', 'build.rs': '_rust', 'Cargo.toml': '_config',
    'Info.plist': '_xml', 'tauri.conf.json': '_json', 'package.json': '_json', 'AGENTS.md': '_markdown',
    'playwright.editor.config.ts': '_typescript', 'pnpm-lock.yaml': '_yml', 'pnpm-workspace.yaml': '_yml',
    'README.md': '_info', 'TODO.md': '_todo', 'tsconfig.json': '_tsconfig', 'tsconfig.node.json': '_json', 'vite.config.ts': '_vite',
    'component.tsx': '_react', '.env.local': '_config', 'Dockerfile': '_docker', 'Makefile': '_makefile',
  };
  for (const [name, id] of Object.entries(cases)) {
    const icon = fileTypeIcon(name); assert.equal(icon.id, id, name);
    assert.equal([...icon.glyph].length, 1); assert.match(icon.color, /^(#[\da-f]{6}|var\(--file-icon-code\))$/i);
    assert.match(icon.lightColor, /^(#[\da-f]{6}|var\(--file-icon-code\))$/i);
  }
});

test('special names and longest suffixes win; unknown names and prototype keys remain safe', () => {
  assert.equal(fileTypeIcon('README.MD').id, '_info');
  assert.equal(fileTypeIcon('file.test.ts').id, '_typescript_1');
  assert.notEqual(fileTypeIcon('file.test.ts').id, fileTypeIcon('file.ts').id);
  assert.equal(fileTypeIcon('main.tf.json').id, '_terraform');
  for (const name of ['Cargo.lock', 'unknown.unregistered-suffix', '__proto__', 'constructor', '', 'some.']) {
    const icon = fileTypeIcon(name); assert.equal(icon.id, '_default', name);
    assert.notEqual(icon.lightColor, icon.color, name);
  }
  assert.equal(fileTypeIcon('not-readme.md').id, '_markdown');
});
