import test from "node:test";
import assert from "node:assert/strict";
import { ExternalFiles } from "./externalFiles.ts";
import { DocumentRegistry, isDocumentDirty } from "./documentRegistry.ts";
class Buffer { callbacks = new Set(); constructor(value) { this.value = value; } getValue() { return this.value; } setValue(value) { this.value = value; for (const fn of this.callbacks) fn(); } onDidChangeContent(fn) { this.callbacks.add(fn); return { dispose: () => this.callbacks.delete(fn) }; } dispose() {} }
function fixture() {
  const file = { source: { kind: "local" }, path: "/a", content: "old", versionToken: "v1", encoding: "utf-8", bom: false, lineEnding: "lf", readOnly: false };
  const registry = new DocumentRegistry("external", (value) => new Buffer(value)); const document = registry.open(file);
  const state = { file: { ...file, content: "new", versionToken: "v2" }, allowed: true, notices: [] };
  const provider = { inspect: async () => state.file, read: async () => state.file };
  const monitor = new ExternalFiles(registry, provider, () => state.allowed, (notices) => { state.notices = notices; });
  return { registry, document, state, provider, monitor };
}
test("external change reloads a clean document once without transient dirty notification", async () => {
  const f = fixture(); let dirty = false; let events = 0;
  f.registry.subscribe(() => { events++; dirty ||= isDocumentDirty(f.registry.get(f.document.id)); });
  await f.monitor.check([f.document.id]); assert.equal(f.document.model.getValue(), "new"); assert.equal(dirty, false); assert.equal(events, 1); assert.deepEqual(f.state.notices, []);
});
test("dirty text and deleted files remain in memory", async () => {
  const f = fixture(); f.document.model.setValue("mine"); await f.monitor.check([f.document.id]);
  assert.equal(f.document.model.getValue(), "mine"); assert.equal(f.state.notices[0].kind, "changed");
  f.state.file.versionToken = null; await f.monitor.check([f.document.id]); assert.equal(f.state.notices[0].kind, "missing");
});
test("late version and reload callbacks cannot overwrite newer edits, lock or cancelled subscription", async () => {
  for (const mode of ["edit", "lock", "cancel"]) {
    const f = fixture(); let resolve; f.provider.read = () => new Promise((r) => { resolve = r; });
    const result = f.monitor.check([f.document.id]); await Promise.resolve();
    if (mode === "edit") f.document.model.setValue("mine"); else if (mode === "lock") f.state.allowed = false; else f.monitor.cancel();
    resolve(f.state.file); await result; assert.equal(f.document.model.getValue(), mode === "edit" ? "mine" : "old");
  }
});
test("a failed connection can recover on the next bounded check", async () => {
  const f = fixture(); const inspect = f.provider.inspect; f.provider.inspect = async () => { throw new Error("disconnected"); };
  await f.monitor.check([f.document.id]); assert.equal(f.state.notices[0].kind, "unavailable");
  f.provider.inspect = inspect; await f.monitor.check([f.document.id]); assert.deepEqual(f.state.notices, []); assert.equal(f.document.model.getValue(), "new");
});
