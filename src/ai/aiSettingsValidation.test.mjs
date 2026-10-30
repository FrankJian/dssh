import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsActionError, resolveModelCatalog } from './aiSettingsValidation.ts';

const provider = { label: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'local-model' };

test('missing custom fields explain what must be filled in', () => {
  assert.match(settingsActionError({ ...provider, label: ' ' }, false), /显示名称/);
  assert.match(settingsActionError({ ...provider, baseUrl: ' ' }, false), /API 地址/);
});

test('saving an empty catalog is allowed but connection testing requires a model', () => {
  const empty = { ...provider, model: '' };
  assert.equal(settingsActionError(empty, false), null);
  assert.match(settingsActionError(empty, true), /填写模型 ID/);
});

test('completed settings allow save and test without a replacement API key', () => {
  for (const testing of [false, true]) {
    assert.equal(settingsActionError(provider, testing), null);
  }
});

const entry = {
  id: 'first-model', displayName: 'First', contextWindow: 256000, maxOutputTokens: 32000,
  inputTypes: ['text'], reasoningEffort: null, reasoningLevels: [],
};

test('first typed model becomes the default without an explicit add', () => {
  const catalog = [];
  const resolved = resolveModelCatalog(catalog, '', null, entry);
  assert.deepEqual(resolved.models, [entry]);
  assert.equal(resolved.model, entry.id);
  assert.equal(settingsActionError({ ...provider, ...resolved }, true), null);
  assert.deepEqual(catalog, []); // Resolving for a test does not save or mutate the catalog.
});

test('additional model preserves the existing default and metadata', () => {
  const second = { ...entry, id: 'second-model', displayName: 'Second', inputTypes: ['text', 'image'],
    reasoningEffort: 'high', reasoningLevels: [{ level: 'high', apiValue: 'custom-high' }] };
  const resolved = resolveModelCatalog([entry], entry.id, null, second);
  assert.deepEqual(resolved.models, [entry, second]);
  assert.equal(resolved.model, entry.id);
});

test('saving an edited model replaces it and updates a renamed default', () => {
  const edited = { ...entry, id: 'renamed', contextWindow: 128000 };
  const resolved = resolveModelCatalog([entry], entry.id, entry.id, edited);
  assert.deepEqual(resolved.models, [edited]);
  assert.equal(resolved.model, 'renamed');
});

test('direct save and test still reject incomplete, duplicate or invalid models', () => {
  assert.throws(() => resolveModelCatalog([], '', null, { ...entry, id: '' }), /模型 ID/);
  assert.throws(() => resolveModelCatalog([entry], entry.id, null, entry), /已添加/);
  assert.throws(() => resolveModelCatalog([], '', null, { ...entry, contextWindow: NaN }), /上下文窗口/);
  assert.throws(() => resolveModelCatalog([], '', null, { ...entry, maxOutputTokens: 256000 }), /最大输出/);
});
