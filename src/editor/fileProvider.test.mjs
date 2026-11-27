import test from "node:test";
import assert from "node:assert/strict";
import { EditorFileProvider } from "./fileProvider.ts";

test("file provider binds sources and does not leak profile IDs into write requests", async () => {
  const scope = { id: "opaque-1", source: { kind: "sftp", profileId: "host-1" }, rootPath: "/etc", initialFile: null };
  const calls = [];
  const provider = new EditorFileProvider(scope, {
    list: async (id, path) => { calls.push([id, path]); return { path, entries: [] }; },
    read: async (r) => ({ ...r, source: scope.source, content: "a", encoding: "utf-8", bom: false, lineEnding: "lf", versionToken: "v1", readOnly: false }),
    save: async (r) => { calls.push(r); return { source: scope.source, path: r.path, versionToken: "v2" }; },
    close: async (id) => { calls.push(id); },
  });
  const file = await provider.read("/etc/a");
  await provider.save({ ...file, expectedVersion: "v1" });
  assert.equal(calls[0].workspaceId, "opaque-1"); assert.equal("source" in calls[0], false);
  await assert.rejects(provider.save({ ...file, source: { kind: "local" }, expectedVersion: "v1" }), /不属于/);
  await provider.close(); await provider.close();
  await assert.rejects(provider.read("/etc/a"), /已关闭/);
  assert.equal(calls.filter((c) => c === "opaque-1").length, 1);
});

test("provider rejects wrong-source responses and late reads from closed scopes", async () => {
  const scope = { id: "one", source: { kind: "local" }, rootPath: null, initialFile: null };
  let complete;
  const io = { read: async () => new Promise((resolve) => { complete = resolve; }), close: async () => {}, list: async () => {}, save: async () => {} };
  const provider = new EditorFileProvider(scope, io);
  const pending = provider.read("/a"); await provider.close(); complete({ source: scope.source, path: "/a" });
  await assert.rejects(pending, /已关闭/);
  const other = new EditorFileProvider(scope, { ...io, read: async () => ({ source: { kind: "sftp", profileId: "other" } }) });
  await assert.rejects(other.read("/a"), /不属于/);
});
