import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NAVIGATION_ICONS, parseNavigationIcons, navigationActivityFallback } from './navigationPreferences.ts';

test('SFTP stays hidden by default and is not inserted into saved preferences', () => {
  assert.deepEqual(DEFAULT_NAVIGATION_ICONS, ['sessions', 'connections', 'tools', 'editor', 'assistant']);
  for (const raw of [null, 'broken', '[]', '["unknown"]']) {
    assert.deepEqual(parseNavigationIcons(raw), DEFAULT_NAVIGATION_ICONS);
  }
  assert.deepEqual(parseNavigationIcons('["sessions","connections","browser"]'), ['sessions', 'connections', 'browser']);
});

test('editor visibility defaults on for new profiles and preserves existing explicit choices', () => {
  assert.ok(DEFAULT_NAVIGATION_ICONS.includes('editor'));
  assert.deepEqual(parseNavigationIcons('["sessions","editor","editor","assistant"]'), ['sessions', 'editor', 'assistant']);
  assert.deepEqual(parseNavigationIcons('["sessions","connections"]'), ['sessions', 'connections']);
  assert.deepEqual(parseNavigationIcons(JSON.stringify(parseNavigationIcons('["sessions","editor"]'))), ['sessions', 'editor']);
});

test('opening editor workspace content does not require the sessions rail icon', () => {
  assert.equal(navigationActivityFallback('sessions', ['connections', 'editor']), null);
  assert.equal(navigationActivityFallback('tools', ['connections', 'editor']), null);
  assert.equal(navigationActivityFallback('connections', ['sftp', 'editor']), 'sftp');
  assert.equal(navigationActivityFallback('sftp', ['connections', 'sftp', 'editor']), null);
});

test('an explicit SFTP visibility choice is preserved alongside other icons', () => {
  assert.deepEqual(parseNavigationIcons('["sessions","sftp","assistant"]'), ['sessions', 'sftp', 'assistant']);
  assert.deepEqual(parseNavigationIcons('["sftp","sftp","unknown"]'), ['sftp']);
});

test('Artifactory is hidden by default and an explicit visibility choice is preserved', () => {
  assert.ok(!DEFAULT_NAVIGATION_ICONS.includes('artifactory'));
  assert.deepEqual(parseNavigationIcons('["sessions","artifactory","assistant"]'), ['sessions', 'artifactory', 'assistant']);
  assert.deepEqual(parseNavigationIcons('["artifactory","artifactory"]'), ['artifactory']);
});

test('legacy navigation adds tools once and retains existing choices', () => {
  assert.deepEqual(parseNavigationIcons('["sessions","connections","sftp"]', true), ['sessions', 'connections', 'tools', 'sftp']);
  assert.deepEqual(parseNavigationIcons('["s3","assistant"]', true), ['tools', 's3', 'assistant']);
  assert.deepEqual(parseNavigationIcons('["sftp","tools"]', true), ['sftp', 'tools']);
  assert.deepEqual(parseNavigationIcons('["sessions","connections","sftp"]'), ['sessions', 'connections', 'sftp']);
});
