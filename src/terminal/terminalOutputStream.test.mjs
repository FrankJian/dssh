import test from "node:test";
import assert from "node:assert/strict";
import { TerminalOutputStream } from "./terminalOutputStream.ts";

const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const session = (id) => ({ id, kind:"ssh", profileId:"profile", title:id, status:"connected" });
const snapshot = (id, data = "login", endOffset = 5) => ({ session:session(id), data, startOffset:endOffset - new TextEncoder().encode(data).length, endOffset });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness() {
  let handler, token = 0;
  const registrations = [], unsubscribed = [], outputs = [], statuses = [], errors = [];
  const services = {
    subscribe: (id, token, fn, afterOffset) => { handler = fn; const pending = defer(); registrations.push({ id, token, afterOffset, ...pending }); return pending.promise; },
    unsubscribe: async (id, token) => { unsubscribed.push({id, token}); },
    token: () => `subscription-${++token}`,
  };
  const stream = new TerminalOutputStream(services, (event) => outputs.push(event.data), (event) => statuses.push(event.status), (error) => errors.push(error));
  return { stream, services, registrations, unsubscribed, outputs, statuses, errors,
    emit(id, data, startOffset, endOffset, subscriptionId = registrations.at(-1)?.token) { handler({type:"output",sessionId:id,subscriptionId,data,startOffset,endOffset}); },
    status(id, status) { handler({type:"status", sessionId:id, subscriptionId:registrations.at(-1)?.token, status}); }
  };
}

test("dedicated channel receives early events and joins them to the snapshot once", async () => {
  const h = harness(), seen = [];
  const started = h.stream.start("a", (value) => seen.push(value.data));
  assert.equal(h.registrations.length, 1);
  await tick();
  h.emit("a", " prompt", 5, 12);
  h.emit("a", "😀", 12, 16);
  assert.deepEqual(h.outputs, []);
  h.registrations[0].resolve(snapshot("a"));
  assert.equal((await started).id, "a");
  assert.deepEqual(seen, ["login"]);
  assert.deepEqual(h.outputs, [" prompt", "😀"]);
  h.emit("a", "😀", 12, 16); // duplicate
  assert.deepEqual(h.outputs, [" prompt", "😀"]);
  h.stream.stopAll(); await tick();
});

test("foreign and forgotten sessions never recreate buffers or activity", async () => {
  const h = harness();
  const started = h.stream.start("a", () => {}); await tick();
  h.registrations[0].resolve(snapshot("a")); await started;
  h.emit("foreign", "secret", 5, 11);
  h.stream.stop("a");
  h.emit("a", "late output", 5, 16);
  assert.deepEqual(h.outputs, []);
  assert.equal(h.stream.has("a"), false);
  await tick(); assert.equal(h.unsubscribed.length, 1);
  h.stream.stopAll();
});

test("cancel during subscribe cleans up after response and cannot overwrite a newer view", async () => {
  const h = harness();
  const old = h.stream.start("a", () => assert.fail("cancelled snapshot applied"));
  const oldRejected = assert.rejects(old, /取消/);
  await tick();
  const current = h.stream.start("a", () => {}); await tick();
  const [first, second] = h.registrations;
  h.emit("a", "old", 5, 8, first.token);
  second.resolve(snapshot("a")); await current;
  first.resolve(snapshot("a")); await oldRejected; await tick();
  assert.deepEqual(h.unsubscribed, [{id:"a",token:first.token}]);
  h.emit("a", "new", 5, 8, second.token);
  assert.deepEqual(h.outputs, ["new"]);
  h.stream.stopAll();
});

test("closing the window while registration is pending leaves no subscription", async () => {
  const h = harness();
  const started = h.stream.start("a", () => assert.fail("unmounted snapshot applied"));
  const rejected = assert.rejects(started, /取消/);
  await tick(); h.stream.stopAll();
  h.registrations[0].resolve(snapshot("a")); await rejected; await tick();
  assert.equal(h.unsubscribed.length, 1);
  assert.equal(h.stream.has("a"), false);
});

test("sequence gaps stop parsing and surface an error instead of silently corrupting ANSI state", async () => {
  const h = harness();
  const started = h.stream.start("a", () => {}); await tick();
  h.registrations[0].resolve(snapshot("a")); await started;
  h.emit("a", "gap", 6, 9);
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.outputs, []);
  assert.equal(h.stream.has("a"), false);
  h.stream.stopAll();
});

test("rejected invoke still attempts token-specific cleanup", async () => {
  const h = harness();
  const started = h.stream.start("a", () => {});
  const rejected = assert.rejects(started, /failure/);
  await tick(); h.registrations[0].reject(new Error("failure")); await rejected; await tick();
  assert.equal(h.unsubscribed.length, 1);
  assert.equal(h.stream.has("a"), false);
  h.stream.stopAll();
});

test("two sessions have independent checkpoints, including a snapshot with trimmed history", async () => {
  const h = harness();
  const a = h.stream.start("a", () => {}), b = h.stream.start("b", () => {}); await tick();
  h.registrations[0].resolve(snapshot("a", "retained tail", 500000));
  h.registrations[1].resolve(snapshot("b")); await Promise.all([a,b]);
  h.emit("a", "one", 500000, 500003, h.registrations[0].token);
  h.emit("b", "two", 5, 8, h.registrations[1].token);
  assert.deepEqual(h.outputs, ["one", "two"]);
  assert.deepEqual(h.errors, []);
  h.stream.stopAll();
});

test("status is held behind the snapshot and remains ordered after its final output", async () => {
  const h = harness();
  const order = [];
  const stream = new TerminalOutputStream(h.services, e=>order.push(e.data), e=>order.push(e.status), e=>assert.fail(e.message));
  const started = stream.start("a", value=>order.push(value.data));
  h.emit("a", "last output", 5, 16);
  h.status("a", "disconnected");
  assert.deepEqual(order, []);
  h.registrations[0].resolve(snapshot("a")); await started;
  assert.deepEqual(order, ["login", "last output", "disconnected"]);
  stream.stopAll();
});

test("resume checkpoint joins Unicode suffix and early live output without replaying the old screen", async () => {
  const h = harness(), seen = [];
  const started = h.stream.start("a", value => seen.push(value.data), 100);
  assert.equal(h.registrations[0].afterOffset, 100);
  h.emit("a", "\x1b[?25h", 107, 113);
  h.registrations[0].resolve(snapshot("a", "中😀", 107));
  await started;
  assert.deepEqual(seen, ["中😀"]);
  assert.deepEqual(h.outputs, ["\x1b[?25h"]);
  assert.deepEqual(h.errors, []);
  h.stream.stopAll();
});

test("invalid or shortened checkpoint responses never paint a partial ANSI history", async () => {
  for (const value of [
    snapshot("a", "tail", 108), // requested 100, starts at 104
    { ...snapshot("a", "中", 103), startOffset:101 }, // bytes vs JS string length
    { ...snapshot("a", "", 100), endOffset:NaN },
    snapshot("other", "tail", 104),
  ]) {
    const h = harness();
    const started = h.stream.start("a", () => assert.fail("invalid snapshot applied"), 100);
    const rejected = assert.rejects(started, /不完整/);
    h.registrations[0].resolve(value);
    await rejected; await tick();
    assert.equal(h.stream.has("a"), false);
    assert.equal(h.unsubscribed.length, 1);
  }
});

test("checkpoint attachment cannot speculatively disconnect an existing view", async () => {
  const h = harness();
  const started = h.stream.start("a", () => {});
  h.registrations[0].resolve(snapshot("a")); await started;
  for (const offset of [NaN, -1, Number.MAX_SAFE_INTEGER + 1, 5]) {
    await assert.rejects(h.stream.start("a", () => assert.fail("existing screen replaced"), offset));
  }
  h.emit("a", "live", 5, 9);
  assert.deepEqual(h.outputs, ["live"]);
  assert.equal(h.registrations.length, 1);
  assert.deepEqual(h.unsubscribed, []);
  h.stream.stopAll();
});
