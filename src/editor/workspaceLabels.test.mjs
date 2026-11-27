import test from "node:test";
import assert from "node:assert/strict";
import { editorWorkspaceLabels } from "./workspaceLabels.ts";
const tab = (id, title, rootPath = null, source = { kind: "local" }) => ({ id, title, workspace: { id, source, rootPath, initialFile: null } });
test("empty workspaces are distinguished without rewriting stored names", () => {
  const tabs = [tab("a", "文本编辑器"), tab("b", "文本编辑器"), tab("c", "个人笔记")];
  assert.deepEqual(editorWorkspaceLabels(tabs).map(item => item.title), ["文本编辑器 1", "文本编辑器 2", "个人笔记"]);
  assert.equal(tabs[0].title, "文本编辑器"); assert.equal(tabs[2].title, "个人笔记");
});
test("same-named roots show the parent and retain full source/path context", () => {
  const labels = editorWorkspaceLabels([tab("a", "test", "/work/test"), tab("b", "test", "/home/test", { kind: "sftp", profileId: "fixture" })]);
  assert.deepEqual(labels.map(item => item.title), ["test · work", "test · home"]);
  assert.equal(labels[0].description, "本地 · /work/test"); assert.equal(labels[1].description, "SSH · /home/test");
});
test("roots with the same parent name still get unambiguous labels", () => {
  const labels = editorWorkspaceLabels([tab("a", "test", "/one/work/test"), tab("b", "test", "/two/work/test")]);
  assert.deepEqual(labels.map(item => item.title), ["test · 1", "test · 2"]);
});
