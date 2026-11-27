import test from "node:test";
import assert from "node:assert/strict";
import { DocumentRegistry, isDocumentDirty } from "./documentRegistry.ts";
import { EditorFileProvider } from "./fileProvider.ts";
import { EditorActions } from "./editorActions.ts";
import { EditorFileError } from "../services/editorService.ts";

class Buffer {
  listeners = new Set();
  constructor(text) { this.text = text; }
  getValue() { return this.text; }
  setValue(text) { this.text = text; for (const callback of this.listeners) callback(); }
  onDidChangeContent(callback) { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; }
  dispose() { this.disposed = true; }
}
function fixture() {
  const source = { kind: "local" };
  const files = new Map(); const writes = []; const reads = []; const prompts = []; const answers = []; const paths = []; const comparisons = [];
  const scope = { id: "scope", source, rootPath: "/root", initialFile: null };
  const state = { locked: false, atomic: true, denied: new Set(), onChoose: () => {} };
  const io = {
    list: async () => ({ path: "/root", entries: [] }), close: async () => {},
    inspect: async (_, path) => ({ source, path: path.replace("/alias/", "/root/"), versionToken: files.get(path)?.versionToken ?? null, readOnly: files.get(path)?.readOnly ?? false, byteLength: 10 }),
    read: async (request) => {
      reads.push(request); const file = files.get(request.path);
      if (!file) throw new EditorFileError("editor_missing", "not found");
      if (file.largeFile && !request.allowLarge) throw new EditorFileError("editor_large_file", "too large");
      if (file.requiredEncoding && request.encoding !== file.requiredEncoding) throw new EditorFileError("editor_encoding", "choose encoding");
      return { ...file };
    },
    save: async (request) => {
      writes.push(request);
      if (state.denied.has(request.path)) throw new EditorFileError("editor_permission", "denied");
      if ((files.get(request.path)?.versionToken ?? null) !== request.expectedVersion) throw new EditorFileError("editor_conflict", "changed");
      if (!state.atomic && !request.allowNonAtomic) throw new EditorFileError("editor_atomic_unavailable", "unsupported");
      const file = { ...request, source, readOnly: false, versionToken: `v${writes.length + 1}` };
      files.set(request.path, file); return { source, path: request.path, versionToken: file.versionToken };
    },
  };
  const registry = new DocumentRegistry("actions", (text) => new Buffer(text));
  const provider = new EditorFileProvider(scope, io);
  const host = {
    choose: async (question) => { prompts.push(question); state.onChoose(question); return answers.shift() ?? null; },
    choosePath: async () => paths.shift() ?? null,
    compare: (...args) => comparisons.push(args), allowed: () => !state.locked,
  };
  const actions = new EditorActions(registry, provider, host);
  const add = (path, extra = {}) => { const file = { source, path, content: "original", encoding: "utf-8", bom: false, lineEnding: "lf", versionToken: "v1", readOnly: false, ...extra }; files.set(path, file); return registry.open(file); };
  return { source, files, writes, reads, prompts, answers, paths, comparisons, state, registry, provider, actions, add };
}

test("canceling first save leaves untitled content without any filesystem write", async () => {
  const f = fixture(); const d = f.actions.newFile("draft");
  assert.equal(await f.actions.save(d.id), false); assert.equal(f.writes.length, 0);
  assert.equal(d.model.getValue(), "draft"); assert.equal(f.registry.get(d.id).identity, null);
});
test("save-as uses the inspected canonical path and commits identity only after success", async () => {
  const f = fixture(); const d = f.actions.newFile("draft"); f.paths.push("/alias/new.txt");
  assert.equal(await f.actions.save(d.id), true); assert.equal(f.registry.get(d.id).identity.path, "/root/new.txt");
  assert.equal(f.writes[0].expectedVersion, null); assert.equal(isDocumentDirty(f.registry.get(d.id)), false);
  d.model.setValue("next"); f.paths.push("/root/denied.txt"); f.state.denied.add("/root/denied.txt");
  await assert.rejects(f.actions.save(d.id, true), /denied/);
  assert.equal(f.registry.get(d.id).identity.path, "/root/new.txt"); assert.ok(isDocumentDirty(f.registry.get(d.id)));
});
test("save all reports partial failure without clearing failed document dirty", async () => {
  const f = fixture(); const a = f.add("/root/a"); const b = f.add("/root/b");
  a.model.setValue("A"); b.model.setValue("B"); f.state.denied.add("/root/a");
  const results = await f.actions.saveAll();
  assert.deepEqual(results.map((r) => r.saved), [false, true]);
  assert.ok(isDocumentDirty(f.registry.get(a.id))); assert.equal(isDocumentDirty(f.registry.get(b.id)), false);
});
test("confirmed conflict overwrite is bound to that version and re-prompts on another change", async () => {
  const f = fixture(); const d = f.add("/root/a"); d.model.setValue("mine");
  f.files.set("/root/a", { ...f.files.get("/root/a"), versionToken: "v2", content: "external" });
  f.answers.push("overwrite", null);
  f.state.onChoose = () => { f.files.set("/root/a", { ...f.files.get("/root/a"), versionToken: "v3", content: "latest" }); };
  assert.equal(await f.actions.save(d.id), false);
  assert.deepEqual(f.writes.map((r) => r.expectedVersion), ["v1", "v2"]);
  assert.equal(f.files.get("/root/a").content, "latest"); assert.equal(d.model.getValue(), "mine");
});
test("conflict comparison preserves the draft and never implicitly writes", async () => {
  const f = fixture(); const d = f.add("/root/a"); d.model.setValue("mine");
  f.files.set("/root/a", { ...f.files.get("/root/a"), versionToken: "v2", content: "external" }); f.answers.push("compare");
  assert.equal(await f.actions.save(d.id), false); assert.deepEqual(f.comparisons, [[d.id, "external", "mine"]]);
  assert.equal(f.writes.length, 1); assert.ok(isDocumentDirty(f.registry.get(d.id)));
});
test("unsafe fallback is explicit and authorization is not retained for the next save", async () => {
  const f = fixture(); const d = f.add("/root/a"); d.model.setValue("mine"); f.state.atomic = false; f.answers.push("continue");
  assert.equal(await f.actions.save(d.id), true);
  assert.deepEqual(f.writes.map((r) => r.allowNonAtomic), [false, true]);
  d.model.setValue("next"); assert.equal(await f.actions.save(d.id), false);
  assert.equal(f.writes[2].allowNonAtomic, false); assert.ok(isDocumentDirty(f.registry.get(d.id)));
});
test("reload cancellation preserves edits; a concurrent edit invalidates a delayed reload", async () => {
  const f = fixture(); const d = f.add("/root/a"); d.model.setValue("mine");
  assert.equal(await f.actions.reload(d.id), false); assert.equal(f.reads.length, 0);
  f.answers.push("discard"); let finish;
  f.provider.read = async () => new Promise((resolve) => { finish = resolve; });
  const reload = f.actions.reload(d.id); await Promise.resolve(); await Promise.resolve();
  d.model.setValue("newer"); finish({ ...f.files.get("/root/a"), content: "external" });
  assert.equal(await reload, false); assert.equal(d.model.getValue(), "newer");
});
test("large file and encoding choices must be made before opening a document", async () => {
  const f = fixture(); const d = f.add("/root/large", { largeFile: true, requiredEncoding: "gb18030", encoding: "gb18030" });
  f.registry.close(d.id); f.answers.push("limited", "gb18030");
  const reopened = await f.actions.open("/root/large");
  assert.equal(reopened.largeFile, true); assert.equal(reopened.metadata.encoding, "gb18030");
  assert.equal(f.reads.at(-1).allowLarge, true); assert.equal(f.reads.at(-1).encoding, "gb18030");
});
test("close preparation is transactional and cancellation does not release any model", async () => {
  const f = fixture(); const a = f.add("/root/a"); const b = f.add("/root/b"); a.model.setValue("A"); b.model.setValue("B");
  f.answers.push("discard", null);
  assert.equal(await f.actions.prepareClose([a.id, b.id]), null);
  assert.equal(f.registry.list().length, 2); assert.equal(a.model.disposed, undefined);
  f.answers.push("discard", "discard"); const plan = await f.actions.prepareClose([a.id, b.id]);
  assert.ok(f.actions.validClose(plan)); a.model.setValue("new"); assert.equal(f.actions.validClose(plan), false);
});
test("lock and invalid dialog answers cannot authorize writes", async () => {
  const f = fixture(); const d = f.actions.newFile("draft"); f.state.locked = true;
  await assert.rejects(f.actions.save(d.id), /不能操作/); f.state.locked = false;
  f.paths.push("/root/existing"); f.add("/root/existing"); f.answers.push("invented answer");
  assert.equal(await f.actions.save(d.id), false); assert.equal(f.writes.length, 0);
});

test("discard cannot authorize text changed while the confirmation is open", async () => {
  const f = fixture(); const d = f.add("/root/a"); d.model.setValue("first draft");
  f.answers.push("discard"); f.state.onChoose = () => d.model.setValue("newer draft");
  assert.equal(await f.actions.prepareClose([d.id]), null);
  assert.equal(d.model.getValue(), "newer draft");
});

test("locking blocks queued saves and unlocking never implicitly replays them", async () => {
 const f = fixture(); const document = f.add('/root/a'); document.model.setValue('first');
 let release; let entered; const started = new Promise(resolve => entered = resolve); const gate = new Promise(resolve => release = resolve);
 const save = f.provider.save.bind(f.provider); let dispatched = 0;
 f.provider.save = async (...args) => { dispatched++; entered(); await gate; return save(...args); };
 const first = f.actions.save(document.id); await started;
 document.model.setValue('newer'); const queued = f.actions.save(document.id); const rejected = assert.rejects(queued, /不能操作/);
 f.state.locked = true; release(); assert.equal(await first, true); await rejected;
 assert.equal(dispatched, 1); assert.equal(f.registry.get(document.id).model.getValue(), 'newer'); assert.equal(isDocumentDirty(f.registry.get(document.id)), true);
 f.state.locked = false; await Promise.resolve(); assert.equal(dispatched, 1);
 assert.equal(await f.actions.save(document.id), true); assert.equal(dispatched, 2);
});
test("discarding reload cannot authorize edits made while its decision is open", async () => {
 const f = fixture(); const document = f.add('/root/a'); document.model.setValue('first');
 f.answers.push('discard'); f.state.onChoose = () => document.model.setValue('newer');
 assert.equal(await f.actions.reload(document.id), false); assert.equal(f.reads.length, 0); assert.equal(document.model.getValue(), 'newer');
});

test("growing a normal document enters limited mode and undo keeps the baseline clean", () => {
 const f = fixture(); const document = f.add('/root/growing');
 document.model.setValue('x'.repeat(20 * 1024 * 1024 + 1)); assert.equal(f.registry.get(document.id).largeFile, true);
 document.model.setValue('original'); assert.equal(isDocumentDirty(f.registry.get(document.id)), false); assert.equal(f.registry.get(document.id).largeFile, true);
});
