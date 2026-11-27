import test from "node:test";
import assert from "node:assert/strict";
import { DocumentRegistry } from "./documentRegistry.ts";
import { runWorkspaceSearch } from "./searchRunner.ts";
import { searchText } from "./searchMatch.ts";
import { applyReplacePlan } from "./replacePlan.ts";
class Buffer { callbacks = new Set(); constructor(value) { this.value = value; } getValue() { return this.value; } setValue(value) { this.value = value; for (const callback of this.callbacks) callback(); } onDidChangeContent(callback) { this.callbacks.add(callback); return { dispose() {} }; } dispose() {} }
const source = { kind: "local" };
const file = (path, content = "needle") => ({ source, path, content, encoding: "utf-8", bom: false, lineEnding: "lf", readOnly: false, versionToken: "v1" });
const request = { workspaceId: "w", content: true, showHidden: false, include: [], exclude: [], skipPaths: [] };
const query = { pattern: "needle", regex: false, wholeWord: false, caseSensitive: true, replacement: "changed" };
const progress = { directories: 1, entries: 2, bytes: 20, unreadable: 0, binary: 0, encoding: 0, oversized: 0, links: 0, done: true, reason: null };
function registry() { return new DocumentRegistry("search", (value) => new Buffer(value)); }

test("directory search prioritizes current dirty models and never returns duplicate disk results", async () => {
 const docs = registry(); const a = docs.open(file("/root/a", "old")); a.model.setValue("needle in memory"); let received; const updates = [];
 const api = { filter: async () => ["/root/a"], start: async (r) => { received = r; return "op"; }, next: async () => ({ operationId: "op", items: [{ path: "/root/a", file: file("/root/a") }, { path: "/root/b", file: file("/root/b") }], progress }), cancel: async () => {} };
 const result = await runWorkspaceSearch({ registry: docs, source, request, query, api, match: async (text, q, n) => searchText(text, q, n), signal: new AbortController().signal, allowed: () => true, update: (value) => updates.push(value) });
 assert.deepEqual(received.skipPaths, ["/root/a"]); assert.equal(result.files.length, 2); assert.equal(result.files[0].original, "needle in memory"); assert.equal(result.files[0].documentId, a.id); assert.equal(result.count, 2);
 assert.equal(docs.get(a.id).model.getValue(), "needle in memory"); assert.ok(updates.length);
});
test("cancelled or late scan batches cannot publish into a newer query", async () => {
 const docs = registry(); const abort = new AbortController(); const updates = []; let finish; let cancel = false;
 const api = { filter: async () => [], start: async () => "op", next: () => new Promise((resolve) => { finish = resolve; }), cancel: async () => { cancel = true; } };
 const result = runWorkspaceSearch({ registry: docs, source, request, query, api, match: async () => { throw new Error("should not run"); }, signal: abort.signal, allowed: () => true, update: (state) => updates.push(state) });
 await Promise.resolve(); await Promise.resolve(); abort.abort(); finish({ operationId: "op", items: [{ path: "/root/a", file: file("/root/a") }], progress });
 await result; assert.equal(updates.length, 0); assert.equal(cancel, true);
});
test("replace applies opened documents to memory, disk files with tokens, and reports partial failure", async () => {
 const docs = registry(); const a = docs.open(file("/root/a")); const files = ["/root/b", "/root/c"].map((path) => file(path)); const writes = [];
 const plan = [{ path: "/root/a", documentId: a.id, revision: a.revision, original: "needle", result: searchText("needle", query) }, ...files.map((f) => ({ path: f.path, file: f, original: f.content, result: searchText(f.content, query) }))];
 const provider = { inspect: async (path) => ({ versionToken: path.endsWith("c") ? "v2" : "v1", readOnly: false }), save: async (request) => writes.push(request) };
 const result = await applyReplacePlan({ plan, source, registry: docs, provider, allowed: () => true, signal: new AbortController().signal, apply: (id, item) => docs.get(id).model.setValue(item.result.content), update() {} });
 assert.deepEqual(result.map((r) => r.status), ["memory", "saved", "conflict"]); assert.equal(a.model.getValue(), "changed"); assert.equal(writes.length, 1); assert.equal(writes[0].expectedVersion, "v1");
});
test("replace plan rejects newer memory revisions and cancellation never rolls back completed writes", async () => {
 const docs = registry(); const a = docs.open(file("/root/a")); const draft = { path: "/root/a", documentId: a.id, revision: a.revision, original: "needle", result: searchText("needle", query) }; a.model.setValue("new draft");
 const abort = new AbortController(); const plan = [draft, ...["/root/b", "/root/c"].map((path) => ({ path, file: file(path), original: "needle", result: searchText("needle", query) }))];
 const writes = []; const provider = { inspect: async () => ({ versionToken: "v1", readOnly: false }), save: async (r) => { writes.push(r); abort.abort(); } };
 const result = await applyReplacePlan({ plan, source, registry: docs, provider, allowed: () => true, signal: abort.signal, apply() { throw new Error("should not edit"); }, update() {} });
 assert.deepEqual(result.map((r) => r.status), ["conflict", "saved", "unprocessed"]); assert.equal(writes.length, 1); assert.equal(a.model.getValue(), "new draft");
});

test("read-only files, partial save failure and a fresh retry retain the exact reviewed versions", async () => {
 const docs = registry(); let failed = true; const writes = [];
 const plan = ["a", "b", "c"].map((name) => { const f = file(`/root/${name}`); if (name === "a") f.readOnly = true; return { path: f.path, file: f, original: f.content, result: searchText(f.content, query) }; });
 const provider = { inspect: async () => ({ versionToken: "v1", readOnly: false }), save: async (r) => { writes.push(r); if (r.path.endsWith("b") && failed) throw new Error("disconnected"); } };
 const options = { plan, source, registry: docs, provider, allowed: () => true, signal: new AbortController().signal, apply() {}, update() {} };
 const result = await applyReplacePlan(options); assert.deepEqual(result.map((r) => r.status), ["failed", "failed", "saved"]);
 failed = false; const retried = await applyReplacePlan({ ...options, plan: [plan[1]] }); assert.equal(retried[0].status, "saved"); assert.deepEqual(writes.map((r) => r.expectedVersion), ["v1", "v1", "v1"]);
});
