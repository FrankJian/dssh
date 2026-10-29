import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  AI_PROVIDERS_KEY, ENDPOINT_PRESETS, API_PROTOCOLS, createEmptyProvider,
  loadLegacyProviders, loadOptions, normalizeModels, DEFAULT_MODEL_CONTEXT_WINDOW, parseTokenCapacity, formatTokenCapacity, inferPresetId, normalizeReasoningLevels, defaultReasoningLevels,
} from './aiConfig.ts';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
beforeEach(() => memory.clear());

test('legacy migration removes retired providers and retains custom model catalogs', () => {
  localStorage.setItem(AI_PROVIDERS_KEY, JSON.stringify([
    { id: 'retired', kind: 'copilot' },
    { id: 'gateway', kind: 'openai', baseUrl: 'https://gateway.test/v1/', model: 'manual', models: ['manual', 'second', 12] },
    { id: 'responses', kind: 'openai-responses', models: [] },
  ]));
  const migrated = loadLegacyProviders();
  assert.deepEqual(migrated.map((p) => p.id), ['gateway', 'responses']);
  assert.equal(migrated[0].kind, 'openai-completions');
  assert.deepEqual(migrated[0].models.map((m) => m.id), ['manual', 'second']);
  assert.equal(migrated[0].models[0].contextWindow, DEFAULT_MODEL_CONTEXT_WINDOW);
  assert.equal(migrated[1].kind, 'openai-responses');
  // Reading is non-destructive; only successful backend writes may clear legacy data.
  assert.notEqual(localStorage.getItem(AI_PROVIDERS_KEY), null);
});

test('fresh configuration is empty and presets carry explicit protocols', () => {
  assert.deepEqual(loadLegacyProviders(), []);
  for (const preset of ENDPOINT_PRESETS) {
    const provider = createEmptyProvider(preset);
    assert.equal(provider.baseUrl, preset.baseUrl);
    assert.equal(provider.kind, preset.kind);
    assert(API_PROTOCOLS.some((p) => p.value === provider.kind));
    assert.equal(provider.hasApiKey, false);
    assert.equal(provider.apiKey, undefined);
  }
  const custom = createEmptyProvider();
  assert.equal(custom.baseUrl, '');
  assert.notEqual(custom.id, createEmptyProvider().id);
});

test('malformed migration input is reported without clearing the source', () => {
  localStorage.setItem(AI_PROVIDERS_KEY, '{invalid');
  assert.throws(() => loadLegacyProviders());
  assert.equal(localStorage.getItem(AI_PROVIDERS_KEY), '{invalid');
});

test('legacy manual compression options are ignored', () => {
  localStorage.setItem('dssh.ai.options', JSON.stringify({ historyMaxChars: 3000, historyRecentChars: 90000 }));
  assert.equal(loadOptions().historyRecentChars, undefined);
  assert.equal(loadOptions().historyMaxChars, undefined);
});

test('model metadata preserves names and capacities while upgrading legacy IDs', () => {
  const models = normalizeModels(['old', { id: ' new ', displayName: 'Friendly', contextWindow: 32768 }, 'old'], 'selected');
  assert.deepEqual(models.map(({id, displayName, contextWindow}) => ({id, displayName, contextWindow})), [
    { id: 'selected', displayName: 'selected', contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW },
    { id: 'old', displayName: 'old', contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW },
    { id: 'new', displayName: 'Friendly', contextWindow: 32768 },
  ]);
  assert.equal(normalizeModels([{ id: 'invalid', contextWindow: -1 }])[0].contextWindow, DEFAULT_MODEL_CONTEXT_WINDOW);
});

test('capacity units and optional model capabilities roundtrip', () => {
  assert.equal(parseTokenCapacity('256K'), 256000);
  assert.equal(parseTokenCapacity('32k'), 32000);
  assert.equal(parseTokenCapacity('1.5M'), 1500000);
  assert.equal(formatTokenCapacity(32000), '32K');
  assert(Number.isNaN(parseTokenCapacity('hello')));
  const model = normalizeModels([{id:'vision', contextWindow:256000, maxOutputTokens:32000, inputTypes:['text','image'], reasoningEffort:'high'}])[0];
  assert.deepEqual(model.inputTypes, ['text','image']);
  assert.equal(model.reasoningEffort, 'high');
  assert.equal(model.maxOutputTokens, 32000);
  assert.equal(normalizeModels(['legacy'])[0].maxOutputTokens, 32000);
});

test('preset identity is explicit and custom routes are never overwritten', () => {
  const deepseek = ENDPOINT_PRESETS.find((p) => p.id === 'deepseek');
  assert.equal(inferPresetId({...deepseek, presetId: null}), 'deepseek');
  assert.equal(inferPresetId({baseUrl:'https://api.deepseek.com/v1/', kind:'openai-completions'}), 'deepseek');
  assert.equal(inferPresetId({...deepseek, presetId:'custom'}), 'custom');
  assert(ENDPOINT_PRESETS.every((p) => p.sourceUrl.startsWith('https://') && p.verifiedOn));
});

test('reasoning API values survive migration, including existing off values', () => {
  assert.deepEqual(normalizeReasoningLevels(undefined, 'high'), defaultReasoningLevels());
  const levels = [{level:'off',apiValue:'legacy-disabled'}, {level:'high',apiValue:'provider-specific'}];
  const model = normalizeModels([{id:'test', reasoningLevels:levels, reasoningEffort:'high'}])[0];
  assert.deepEqual(model.reasoningLevels, levels);
  assert.equal(model.reasoningEffort, 'high');
  assert.equal(normalizeModels(['plain'])[0].reasoningEffort, null);
  assert.deepEqual(normalizeModels(['plain'])[0].reasoningLevels, []);
});
