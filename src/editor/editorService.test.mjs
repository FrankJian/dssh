import assert from "node:assert/strict";
import test from "node:test";
import { openEditorWorkspace, readEditorText, saveEditorText, closeEditorWorkspace, listEditorFiles, setNativeEditorContext, EditorFileError } from "../services/editorService.ts";

test("editor IPC sends camelCase DTOs, owns sources through workspace IDs and preserves conflict codes", async () => {
  const calls = [];
  const previous = globalThis.window;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === "editor_save_text") throw { code: "editor_conflict", message: "文件发生变化。", details: { expected: "old" } };
    return command === "editor_open_workspace" ? { id: "editor-1", source: args.request.source, rootPath: "/root", initialFile: null } : {};
  } } };
  try {
    const scope = await openEditorWorkspace({ source: { kind: "sftp", profileId: "saved-1" }, path: "/root", directory: true });
    await readEditorText({ workspaceId: scope.id, path: "/root/a", encoding: "utf-16le", allowLarge: true });
    await listEditorFiles(scope.id, "/root");
    await assert.rejects(saveEditorText({ workspaceId: scope.id, path: "/root/a", content: "hello", encoding: "utf-16le", bom: true, lineEnding: "crlf", expectedVersion: "old" }), (error) => {
      assert.ok(error instanceof EditorFileError); assert.equal(error.code, "editor_conflict"); assert.equal(error.message, "文件发生变化。"); return true;
    });
    await closeEditorWorkspace(scope.id);
    assert.deepEqual(calls.map(([command]) => command), ["editor_open_workspace", "editor_read_text", "editor_list", "editor_save_text", "editor_close_workspace"]);
    assert.deepEqual(calls[1][1], { request: { workspaceId: "editor-1", path: "/root/a", encoding: "utf-16le", allowLarge: true } });
    assert.equal("profileId" in calls[3][1].request, false);
  } finally { globalThis.window = previous; }
});

test("file opens retain a separate camelCase browser root context", async () => {
  const previous = globalThis.window;
  const request = { source: { kind: "sftp", profileId: "fixture" }, path: "/root/nested/file.txt", directory: false, rootPath: "/root" };
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    assert.equal(command, "editor_open_workspace"); assert.deepEqual(args, { request });
    return { id: "scope", source: request.source, rootPath: request.rootPath, initialFile: request.path };
  } } };
  try { assert.deepEqual(await openEditorWorkspace(request), { id: "scope", source: request.source, rootPath: "/root", initialFile: request.path }); }
  finally { globalThis.window = previous; }
});


test("native focus updates serialize across pending failures without carrying a caller window label", async () => {
  const previous = globalThis.window; const calls = []; let release;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    assert.equal(command, "editor_set_native_context"); calls.push(args);
    if (calls.length === 1) { await new Promise(resolve => { release = resolve; }); throw { code: "menu", message: "retry" }; }
  } } };
  try {
    const first = setNativeEditorContext(true); const rejected = assert.rejects(first);
    const second = setNativeEditorContext(false); const third = setNativeEditorContext(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ active: true, menus: [], textInput: false }]);
    release(); await rejected; await Promise.all([second, third]);
    assert.deepEqual(calls, [{ active: true, menus: [], textInput: false }, { active: false, menus: [], textInput: false }, { active: true, menus: [], textInput: false }]);
  } finally { globalThis.window = previous; }
});
