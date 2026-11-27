import type { EditorWorkspaceReference } from "./layoutReferences.ts";
import type { EditorWorkbenchHandle } from "./EditorWorkbench.tsx";
import type { EditorWorkspace } from "../models/editor.ts";
import type { DetachedWorkspace } from "../models/workspace.ts";
export interface EditorTransferIO {
  allowed(): boolean;
  start(workspaceId: string, reference: EditorWorkspaceReference): Promise<{ workspace: DetachedWorkspace; handoffId: string }>;
  opened(workspace: DetachedWorkspace): void;
  wait(handoffId: string): Promise<boolean>;
  finish(handoffId: string, commit: boolean): Promise<void>;
}
/** Neither opening a window nor acknowledging initialization releases the source. */
export async function transferEditorWorkspace(source: { workspace: EditorWorkspace; title: string }, handle: EditorWorkbenchHandle, io: EditorTransferIO): Promise<boolean> {
  if (!io.allowed()) return false;
  const plan = await handle.prepareClose();
  if (!plan || !io.allowed() || !handle.validClose(plan)) return false;
  const state = handle.snapshot(true); if (!state) throw new Error("无法读取编辑器布局。");
  let handoffId: string | undefined; let committed = false;
  handle.freeze();
  try {
    const opened = await io.start(source.workspace.id, { source: source.workspace.source, rootPath: source.workspace.rootPath, initialFile: null, title: source.title, state });
    handoffId = opened.handoffId; io.opened(opened.workspace);
    if (!await io.wait(handoffId)) throw new Error("目标编辑器未完成初始化，源文档已保留。");
    if (!io.allowed() || !handle.validFrozenClose(plan)) throw new Error("移窗期间文档状态变化，源文档已保留。");
    await io.finish(handoffId, true); committed = true; return true;
  } finally {
    if (!committed) { if (handoffId) await io.finish(handoffId, false).catch(() => undefined); handle.thaw(); }
  }
}
