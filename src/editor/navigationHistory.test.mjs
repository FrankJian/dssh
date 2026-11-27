import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorNavigationHistory } from './navigationHistory.ts';
const point = (id, line = 1) => ({ id, path: `/root/${id}`, line, column: 1 });
test('navigation keeps cursor locations, truncates forward history and bounds memory', () => {
  const history = new EditorNavigationHistory();
  assert.equal(history.move(-1), null);
  history.record(point('a')); history.update(point('a', 12)); history.record(point('b'));
  assert.deepEqual(history.move(-1), point('a', 12));
  assert.deepEqual(history.move(1), point('b'));
  history.move(-1); history.record(point('c'));
  assert.equal(history.canForward, false);
  for (let i = 0; i < 150; i++) history.record(point(String(i)));
  let count = 0; while (history.move(-1)) count++;
  assert.equal(count, 99);
});
