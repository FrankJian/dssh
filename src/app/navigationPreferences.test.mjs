import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NAVIGATION_ICONS, parseNavigationIcons } from './navigationPreferences.ts';

test('SFTP stays hidden by default and is not inserted into saved preferences', () => {
  assert.deepEqual(DEFAULT_NAVIGATION_ICONS, ['sessions', 'connections', 'assistant']);
  for (const raw of [null, 'broken', '[]', '["unknown"]']) {
    assert.deepEqual(parseNavigationIcons(raw), DEFAULT_NAVIGATION_ICONS);
  }
  assert.deepEqual(parseNavigationIcons('["sessions","connections","browser"]'), ['sessions', 'connections', 'browser']);
});

test('an explicit SFTP visibility choice is preserved alongside other icons', () => {
  assert.deepEqual(parseNavigationIcons('["sessions","sftp","assistant"]'), ['sessions', 'sftp', 'assistant']);
  assert.deepEqual(parseNavigationIcons('["sftp","sftp","unknown"]'), ['sftp']);
});
