import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NAVIGATION_ICONS, parseNavigationIcons } from './navigationPreferences.ts';

test('SFTP stays hidden by default and is not inserted into saved preferences', () => {
  assert.deepEqual(DEFAULT_NAVIGATION_ICONS, ['sessions', 'connections', 'tools', 'assistant']);
  for (const raw of [null, 'broken', '[]', '["unknown"]']) {
    assert.deepEqual(parseNavigationIcons(raw), DEFAULT_NAVIGATION_ICONS);
  }
  assert.deepEqual(parseNavigationIcons('["sessions","connections","browser"]'), ['sessions', 'connections', 'browser']);
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
