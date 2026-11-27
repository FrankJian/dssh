import type { EditorDeletePreview, EditorFileAction, EditorFileMutationResult, EditorWorkspace } from "../models/editor.ts";
import { DocumentRegistry, type TextBuffer } from "./documentRegistry.ts";
import { EditorActions, type ClosePlan, type EditorQuestion } from "./editorActions.ts";
export interface FileOperationsApi {
  begin(workspaceId: string): Promise<string>;
  cancel(workspaceId: string, operationId: string): Promise<void>;
  mutate(workspaceId: string, operationId: string, action: EditorFileAction): Promise<EditorFileMutationResult[]>;
  preview(workspaceId: string, path: string): Promise<EditorDeletePreview>;
}
export function affectedEditorDocuments<M extends TextBuffer, V>(registry: DocumentRegistry<M, V>, paths: string[], windowsPaths = false): string[] {
  const normalize = (path: string) => windowsPaths ? path.replace(/\\/g, "/").replace(/\/$/, "") : path.replace(/\/$/, "");
  return registry.list().filter((document) => document.identity && paths.some((path) => {
    const parent = normalize(path); const file = normalize(document.identity!.path); return file === parent || file.startsWith(`${parent}/`);
  })).map((document) => document.id);
}
export function topLevelEditorPaths(paths: string[], windowsPaths: boolean): string[] {
  const normalize = (path: string) => (windowsPaths ? path.replace(/\\/g, "/") : path).replace(/\/$/, "");
  const unique = [...new Set(paths)];
  return unique.filter((path) => !unique.some((parent) => parent !== path && normalize(path).startsWith(`${normalize(parent)}/`)));
}
export async function performFileMutation<M extends TextBuffer, V>(options: {
  workspace: EditorWorkspace; registry: DocumentRegistry<M, V>; actions: EditorActions<M, V>; action: EditorFileAction; api: FileOperationsApi;
  windowsPaths: boolean; signal: AbortSignal; allowed(): boolean;
  choose(question: EditorQuestion): Promise<string | null>; commitClose(plan: ClosePlan): Promise<boolean>; started(id: string): void;
}): Promise<EditorFileMutationResult[] | null> {
  const guard = () => { if (options.signal.aborted || !options.allowed()) throw new Error("文件操作已取消或当前不可用。"); };
  guard(); const action = "paths" in options.action ? { ...options.action, paths: topLevelEditorPaths(options.action.paths, options.windowsPaths) } : options.action;
  const changesIdentity = ["rename", "move", "delete"].includes(action.kind);
  const paths = "paths" in action ? action.paths : "path" in action ? [action.path] : [];
  const ids = changesIdentity ? affectedEditorDocuments(options.registry, paths, options.windowsPaths) : [];
  // Decisions are collected without destroying drafts. A later preview cancel leaves them intact.
  const plan = await options.actions.prepareClose(ids); if (!plan) return null; guard();
  if (action.kind === "delete") {
    const previews = [];
    for (const path of action.paths) { guard(); previews.push(await options.api.preview(options.workspace.id, path)); }
    guard();
    const summary = previews.reduce((total, item) => ({ files: total.files + item.files, directories: total.directories + item.directories, links: total.links + item.symlinks }), { files: 0, directories: 0, links: 0 });
    const answer = await options.choose({ title: "确认删除", message: `${action.paths.join("\n")}\n\n${summary.files} 个文件、${summary.directories} 个目录、${summary.links} 个链接。删除无法撤销。\n${previews.flatMap((item) => item.paths).slice(0, 30).join("\n")}${previews.some((item) => item.truncated) || summary.files + summary.directories + summary.links > 30 ? "\n…仅显示部分路径" : ""}`, choices: [{ id: "delete", label: "确认删除", danger: true }] });
    if (answer !== "delete") return null;
  }
  guard(); if (!options.actions.validClose(plan)) return null;
  if (!await options.commitClose(plan)) return null;
  guard(); const operationId = await options.api.begin(options.workspace.id); options.started(operationId);
  try { guard();
    if (changesIdentity && affectedEditorDocuments(options.registry, paths, options.windowsPaths).length) throw new Error("受影响文件已重新打开，请重新确认文件操作。");
    return await options.api.mutate(options.workspace.id, operationId, action); }
  finally { await options.api.cancel(options.workspace.id, operationId).catch(() => {}); }
}
