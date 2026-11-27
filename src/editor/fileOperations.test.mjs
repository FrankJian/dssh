import test from "node:test";
import assert from "node:assert/strict";
import { DocumentRegistry } from "./documentRegistry.ts";
import { EditorActions } from "./editorActions.ts";
import { affectedEditorDocuments, performFileMutation, topLevelEditorPaths } from "./fileOperations.ts";
class Buffer { callbacks = new Set(); constructor(value) { this.value = value; } getValue() { return this.value; } setValue(value) { this.value = value; for (const callback of this.callbacks) callback(); } onDidChangeContent(callback) { this.callbacks.add(callback); return { dispose() {} }; } dispose() { this.disposed = true; } }
function fixture() {
 const workspace = { id: "w", source: { kind: "local" }, rootPath: "/root", initialFile: null }; const registry = new DocumentRegistry("files", (value) => new Buffer(value));
 const d = registry.open({ source: workspace.source, path: "/root/parent/a", content: "old", versionToken: "v1", encoding: "utf-8", bom: false, lineEnding: "lf", readOnly: false }); d.model.setValue("draft");
 const calls = []; const actions = new EditorActions(registry, { workspace }, { allowed: () => true, choose: async () => "discard", choosePath: async () => null, compare() {} });
 const api = { begin: async () => { calls.push("begin"); return "op"; }, cancel: async () => { calls.push("cancel"); }, mutate: async () => { calls.push("mutate"); return [{ path: "/root/parent", destination: null, status: "success", message: null }]; }, preview: async (workspaceId, path) => ({ path, files: 1, directories: 1, symlinks: 0, paths: [path, `${path}/a`], truncated: false }) };
 const options = { workspace, registry, actions, action: { kind: "delete", paths: ["/root/parent"] }, api, windowsPaths: false, signal: new AbortController().signal, allowed: () => true, choose: async () => "delete", commitClose: async (plan) => { calls.push("close"); for (const decision of plan.documents) registry.close(decision.id, decision.discard); return true; }, started() {} };
 return { workspace, registry, d, calls, options };
}
test("cancelling deletion preview preserves a draft even after a discard decision", async () => {
 const f = fixture(); assert.equal(await performFileMutation({ ...f.options, choose: async () => null }), null);
 assert.equal(f.d.model.getValue(), "draft"); assert.equal(f.registry.list().length, 1); assert.deepEqual(f.calls, []);
});
test("file mutation commits document close only after preview confirmation", async () => {
 const f = fixture(); await performFileMutation(f.options); assert.deepEqual(f.calls, ["close", "begin", "mutate", "cancel"]); assert.equal(f.d.model.disposed, true);
});
test("new edits during preview invalidate the close plan without filesystem changes", async () => {
 const f = fixture(); assert.equal(await performFileMutation({ ...f.options, choose: async () => { f.d.model.setValue("newer"); return "delete"; } }), null);
 assert.deepEqual(f.calls, []); assert.equal(f.d.model.getValue(), "newer");
});
test("affected files use path component boundaries and preserve case and POSIX backslashes", () => {
 const f = fixture(); assert.deepEqual(affectedEditorDocuments(f.registry, ["/root/parent"]), [f.d.id]); assert.deepEqual(affectedEditorDocuments(f.registry, ["/root/par"]), []); assert.deepEqual(affectedEditorDocuments(f.registry, ["/ROOT/parent"]), []);
});

test("copy keeps the source draft open and uses no discard authorization", async () => {
 const f = fixture(); f.options.actions.prepareClose = async (ids) => { assert.deepEqual(ids, []); return { documents: [] }; };
 await performFileMutation({ ...f.options, action: { kind: "copy", paths: ["/root/parent"], targetDirectory: "/target" } });
 assert.equal(f.registry.get(f.d.id).model.getValue(), "draft"); assert.equal(f.d.model.disposed, undefined);
});
test("a file reopened during operation initialization blocks path mutation", async () => {
 const f = fixture(); const begin = f.options.api.begin;
 f.options.api.begin = async () => { const id = await begin(); f.registry.open({ source: f.workspace.source, path: "/root/parent/a", content: "reopened", versionToken: "v2", encoding: "utf-8", bom: false, lineEnding: "lf", readOnly: false }); return id; };
 await assert.rejects(performFileMutation(f.options), /重新打开/); assert.deepEqual(f.calls, ["close", "begin", "cancel"]);
});
test("selected ancestors cover descendants without merging POSIX backslashes or sibling prefixes", () => {
 assert.deepEqual(topLevelEditorPaths(['/root/a/b', '/root/a', '/root/ab', '/root/a'], false), ['/root/a', '/root/ab']);
 assert.deepEqual(topLevelEditorPaths(['C:\\root\\a', 'C:\\root\\a\\b'], true), ['C:\\root\\a']);
 assert.deepEqual(topLevelEditorPaths(['/root/a\\b', '/root/a'], false), ['/root/a\\b', '/root/a']);
});
