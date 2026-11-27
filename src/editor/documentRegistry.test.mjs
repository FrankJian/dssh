import assert from "node:assert/strict";
import test from "node:test";
import { DocumentRegistry, documentUri, fileIdentityKey, isDocumentDirty } from "./documentRegistry.ts";

class Buffer {
  listeners = new Set();
  disposed = false;
  constructor(content) { this.content = content; }
  getValue() { return this.content; }
  setValue(content) { this.edit(content); }
  edit(content) { this.content = content; for (const listener of this.listeners) listener(); }
  onDidChangeContent(listener) { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  dispose() { this.disposed = true; }
}
const registry = (namespace = "window/workspace") => new DocumentRegistry(namespace, (text) => new Buffer(text));
const file = (extra = {}) => ({ source: { kind: "local" }, path: "/tmp/a.txt", content: "saved\n", encoding: "utf-8", lineEnding: "lf", bom: false, versionToken: "v1", readOnly: false, ...extra });
const defer = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const saved = (snapshot, versionToken = "v2") => ({ source: snapshot.source, path: snapshot.path, versionToken });

test("canonical path identities preserve case, UNC and remote source boundaries", () => {
  const paths = ["C:\\Work\\A.txt", "c:\\Work\\a.txt", "\\\\server\\share\\a.txt", "/A.txt", "/a.txt"];
  const r = registry();
  for (const path of paths) r.open(file({ path }));
  r.open(file({ source: { kind: "sftp", profileId: "one" } }));
  r.open(file({ source: { kind: "sftp", profileId: "two" } }));
  assert.equal(r.list().length, 7);
  assert.equal(r.open(file()).id, r.open(file()).id);
  assert.notEqual(fileIdentityKey(file()), fileIdentityKey(file({ source: { kind: "sftp", profileId: "one" } })));
});
test("model URIs isolate instances and escape path/query/fragment characters", () => {
  const a = registry("first").open(file({ path: "/目录/a#b?.ts" }));
  const b = registry("second").open(file({ path: "/目录/a#b?.ts" }));
  assert.notEqual(a.uri, b.uri);
  const url = new URL(a.uri);
  assert.equal(url.hash, ""); assert.equal(url.search, "");
  assert.ok(a.uri.includes("%23"));
  assert.notEqual(documentUri("a/b", "1", "a"), documentUri("a", "b/1", "a"));
});
test("untitled documents have independent identities and require a save location", async () => {
  const r = registry(); const a = r.createUntitled(); const b = r.createUntitled();
  assert.notEqual(a.id, b.id); assert.ok(isDocumentDirty(a));
  let writes = 0;
  await assert.rejects(r.save(a.id, async () => { writes++; }), /保存位置/);
  assert.equal(writes, 0); assert.equal(r.list().length, 2);
});
test("model edits notify once and undoing to baseline clears dirty", () => {
  const r = registry(); const d = r.open(file()); let calls = 0;
  const unsubscribe = r.subscribe(() => calls++);
  d.model.edit("changed"); assert.ok(isDocumentDirty(r.get(d.id)));
  d.model.edit("saved\n"); assert.equal(isDocumentDirty(r.get(d.id)), false);
  assert.equal(calls, 2); assert.equal(r.get(d.id).revision, 2);
  unsubscribe(); d.model.edit("next"); assert.equal(calls, 2);
});
test("encoding and line ending changes are dirty without modifying the buffer", () => {
  const r = registry(); const d = r.open(file());
  r.setMetadata(d.id, { encoding: "utf-16le", lineEnding: "crlf" });
  assert.equal(d.model.getValue(), "saved\n"); assert.ok(isDocumentDirty(r.get(d.id)));
  r.setMetadata(d.id, { encoding: "utf-8", lineEnding: "lf" });
  assert.equal(isDocumentDirty(r.get(d.id)), false);
});
test("groups share a buffer but keep independent view state and prevent premature disposal", () => {
  const r = registry(); const d = r.open(file());
  r.retainView(d.id, "left"); r.retainView(d.id, "right");
  r.saveViewState(d.id, "left", { line: 3 }); r.saveViewState(d.id, "right", { line: 12 });
  assert.deepEqual(r.retainView(d.id, "left"), { line: 3 });
  assert.deepEqual(r.retainView(d.id, "right"), { line: 12 });
  assert.equal(r.viewCount(d.id), 2); assert.equal(r.close(d.id), false);
  r.releaseView(d.id, "left"); assert.equal(d.model.disposed, false);
  r.releaseView(d.id, "right"); assert.equal(r.close(d.id), true);
  assert.equal(d.model.disposed, true); assert.equal(d.model.listeners.size, 0);
});
test("dirty buffers require explicit discard and hiding views does not discard", () => {
  const r = registry(); const d = r.open(file()); d.model.edit("unsaved");
  r.retainView(d.id, "a"); r.releaseView(d.id, "a");
  assert.equal(r.close(d.id), false); assert.equal(d.model.getValue(), "unsaved");
  assert.equal(r.close(d.id, true), true);
});
test("unmounting and remounting a view retains its independent cursor state", () => {
  const r = registry(); const d = r.open(file());
  r.retainView(d.id, "left"); r.saveViewState(d.id, "left", { line: 42 });
  r.releaseView(d.id, "left"); assert.equal(r.viewCount(d.id), 0);
  assert.deepEqual(r.retainView(d.id, "left"), { line: 42 });
});
test("two untitled documents cannot race to claim the same save-as target", async () => {
  const r = registry(); const a = r.createUntitled("A"); const b = r.createUntitled("B"); const gate = defer();
  const target = { identity: { source: { kind: "local" }, path: "/new.txt" }, expectedVersion: null };
  const first = r.save(a.id, async (s) => { await gate.promise; return saved(s); }, target);
  await Promise.resolve();
  await assert.rejects(r.save(b.id, async (s) => saved(s), target), /正在由另一个文档保存/);
  gate.resolve(); await first;
  assert.equal(r.find(target.identity).id, a.id); assert.equal(r.get(b.id).identity, null);
});
test("saving uses a snapshot and late success cannot clear newer edits or metadata", async () => {
  const r = registry(); const d = r.open(file()); const gate = defer(); let request;
  d.model.edit("A");
  const pending = r.save(d.id, async (snapshot) => { request = snapshot; return gate.promise; });
  await Promise.resolve(); assert.ok(r.get(d.id).saving);
  d.model.edit("B"); r.setMetadata(d.id, { encoding: "utf-8-bom" });
  assert.equal(r.close(d.id, true), false);
  gate.resolve(saved(request)); await pending;
  assert.equal(r.get(d.id).savedContent, "A"); assert.equal(r.get(d.id).savedMetadata.encoding, "utf-8");
  assert.equal(d.model.getValue(), "B"); assert.ok(isDocumentDirty(r.get(d.id)));
});
test("queued saves use the preceding successful token and latest buffer", async () => {
  const r = registry(); const d = r.open(file()); const gate = defer(); const requests = [];
  d.model.edit("A");
  const first = r.save(d.id, async (s) => { requests.push(s); await gate.promise; return saved(s, "v2"); });
  const second = r.save(d.id, async (s) => { requests.push(s); return saved(s, "v3"); });
  await Promise.resolve(); d.model.edit("B"); gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(requests.map((s) => [s.content, s.expectedVersion]), [["A", "v1"], ["B", "v2"]]);
  assert.equal(r.get(d.id).versionToken, "v3"); assert.equal(isDocumentDirty(r.get(d.id)), false);
});
test("failed save preserves baseline, dirty buffer and identity; later retry succeeds", async () => {
  const r = registry(); const d = r.open(file()); d.model.edit("changed");
  await assert.rejects(r.save(d.id, async () => { throw new Error("权限不足"); }), /权限不足/);
  assert.equal(r.get(d.id).savedContent, "saved\n"); assert.equal(r.get(d.id).versionToken, "v1");
  assert.equal(r.get(d.id).error, "权限不足"); assert.ok(isDocumentDirty(r.get(d.id)));
  await r.save(d.id, async (s) => saved(s));
  assert.equal(r.get(d.id).error, null); assert.equal(isDocumentDirty(r.get(d.id)), false);
});
test("save as commits the new identity only after success", async () => {
  const r = registry(); const d = r.createUntitled("draft");
  const target = { identity: { source: { kind: "local" }, path: "/new.txt" }, expectedVersion: null };
  await assert.rejects(r.save(d.id, async () => { throw new Error("denied"); }, target));
  assert.equal(r.get(d.id).identity, null); assert.ok(isDocumentDirty(r.get(d.id)));
  await r.save(d.id, async (s) => { assert.equal(s.expectedVersion, null); return saved(s); }, target);
  assert.equal(r.find(target.identity).id, d.id); assert.equal(isDocumentDirty(r.get(d.id)), false);
});
test("read-only writes require save as and cannot overwrite another open document", async () => {
  const r = registry(); const d = r.open(file({ readOnly: true }));
  await assert.rejects(r.save(d.id, async (s) => saved(s)), /只读/);
  const other = r.open(file({ path: "/other.txt" }));
  await assert.rejects(r.save(d.id, async (s) => saved(s), { identity: other.identity, expectedVersion: "v1" }), /已在此工作区打开/);
});
test("unexpected save identity cannot corrupt the path index or baseline", async () => {
  const r = registry(); const d = r.open(file()); d.model.edit("draft");
  await assert.rejects(r.save(d.id, async (s) => ({ ...saved(s), path: "/wrong" })), /不匹配/);
  assert.equal(r.find(file()).id, d.id); assert.equal(r.get(d.id).savedContent, "saved\n");
});
test("dispose ignores late save callbacks and never resurrects released documents", async () => {
  const r = registry(); const d = r.open(file()); const gate = defer();
  const pending = r.save(d.id, async (s) => { await gate.promise; return saved(s); });
  await Promise.resolve(); r.dispose(); r.dispose(); gate.resolve(); await pending;
  assert.equal(d.model.disposed, true); assert.equal(d.model.listeners.size, 0); assert.equal(r.list().length, 0);
  assert.throws(() => r.createUntitled(), /已关闭/);
});
