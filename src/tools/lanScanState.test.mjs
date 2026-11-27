import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SCAN, applyScanUpdate, failScan } from './lanScanState.ts';

const row = (ip, status) => ({ ip, status, evidence: status, mac: null, responseMs: null, checkedAt: null, source: null });
const update = (sequence, rows, phase = 'running') => ({ scanId: 'current', sequence, range: '192.168.1.0/24', phase, completed: 1, total: 254, rows });

test('IP scan accepts ordered batches and ignores previous tasks and stale batches', () => {
  const initial = { ...EMPTY_SCAN, scanId: 'current', phase: 'starting' };
  const running = applyScanUpdate(initial, update(0, [row('192.168.1.1', 'scanning'), row('192.168.1.2', 'pending')]));
  const next = applyScanUpdate(running, update(1, [row('192.168.1.1', 'occupied')]));
  assert.deepEqual(next.rows.map(r => r.status), ['occupied', 'pending']);
  assert.equal(applyScanUpdate(next, update(0, [])), next);
  assert.equal(applyScanUpdate(next, { ...update(2, []), scanId: 'previous' }), next);
});

test('Stopping survives in-flight progress and incomplete addresses never become green on failure', () => {
  const current = { ...EMPTY_SCAN, scanId: 'current', sequence: 0, phase: 'stopping', rows: [row('192.168.1.1', 'occupied'), row('192.168.1.2', 'scanning'), row('192.168.1.3', 'pending')] };
  assert.equal(applyScanUpdate(current, update(1, [])).phase, 'stopping');
  assert.deepEqual(failScan(current).rows.map(r => r.status), ['occupied', 'unfinished', 'unfinished']);
  const cancelled = applyScanUpdate(current, update(2, [row('192.168.1.2', 'unfinished'), row('192.168.1.3', 'unfinished')], 'cancelled'));
  assert.equal(cancelled.phase, 'cancelled');
  assert.deepEqual(cancelled.rows.map(r => r.status), ['occupied', 'unfinished', 'unfinished']);
});
