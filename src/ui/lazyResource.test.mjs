import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyResource } from './lazyResource.ts';

test('concurrent terminal-like loads share one request and retain the successful runtime', async () => {
  let calls = 0, release;
  const runtime = { Terminal: class {} };
  const resource = createLazyResource(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(resource.get(), undefined);
  const first = resource.load(), second = resource.load();
  assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1);
  release(runtime); assert.equal(await first, runtime);
  assert.equal(resource.get(), runtime);
  assert.equal(await resource.load(), runtime); assert.equal(calls, 1);
});

test('failed import can be explicitly retried without caching a rejection', async () => {
  let calls = 0;
  const resource = createLazyResource(async () => { if (++calls === 1) throw new TypeError('Importing a module script failed.'); return { ready: true }; });
  const first = resource.load(), second = resource.load();
  assert.equal(first, second);
  await assert.rejects(first, TypeError); assert.equal(resource.get(), undefined);
  assert.deepEqual(await resource.load(), { ready: true }); assert.equal(calls, 2);
});

test('synchronous loader errors are handled as a failed request and permit retry', async () => {
  let calls = 0;
  const resource = createLazyResource(() => { if (++calls === 1) throw new Error('unavailable'); return Promise.resolve({ ready: true }); });
  await assert.rejects(resource.load(), /unavailable/);
  assert.deepEqual(await resource.load(), { ready: true });
});
