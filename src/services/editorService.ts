import type { NativeEditorMenuItem } from "../editor/nativeMenu";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EditorScanRequest, EditorScanBatch } from "../models/editor";
import type { EditorFileVersion, EditorOpenRequest, EditorReadRequest, EditorSaveRequest, EditorWorkspace, LoadedText, SavedText } from "../models/editor";
import type { SftpListing } from "./sftpService";

export class EditorFileError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message); this.name = "EditorFileError"; this.code = code; this.details = details;
  }
}

async function editorCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (error) {
    if (error instanceof EditorFileError) throw error;
    const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
    throw new EditorFileError(typeof record.code === "string" ? record.code : "editor_request",
      typeof record.message === "string" ? record.message : error instanceof Error ? error.message : "编辑器文件操作失败，请重试。",
      record.details && typeof record.details === "object" ? record.details as Record<string, unknown> : undefined);
  }
}

export const openEditorWorkspace = (request: EditorOpenRequest) => editorCommand<EditorWorkspace>("editor_open_workspace", { request });
export const closeEditorWorkspace = (workspaceId: string) => editorCommand<void>("editor_close_workspace", { workspaceId });
export const listEditorFiles = (workspaceId: string, path: string) => editorCommand<SftpListing & { truncated?: boolean }>("editor_list", { workspaceId, path });
export const readEditorText = (request: EditorReadRequest) => editorCommand<LoadedText>("editor_read_text", { request });
export const saveEditorText = (request: EditorSaveRequest) => editorCommand<SavedText>("editor_save_text", { request });
export const inspectEditorFile = (workspaceId: string, path: string) => editorCommand<EditorFileVersion>("editor_inspect_file", { workspaceId, path });
export const watchEditorFiles = (workspaceId: string, paths: string[]) => editorCommand<string>("editor_watch_files", { workspaceId, paths });
export const onEditorFilesChanged = (receive: (event: { workspaceId: string; watchId: string }) => void) => listen<{ workspaceId: string; watchId: string }>("editor://files-changed", (event) => receive(event.payload));
export const startEditorScan = (request: EditorScanRequest) => editorCommand<string>("editor_start_scan", { request });
export const nextEditorScan = (workspaceId: string, operationId: string) => editorCommand<EditorScanBatch>("editor_next_scan", { workspaceId, operationId });
export const cancelEditorScan = (workspaceId: string, operationId: string) => editorCommand<void>("editor_cancel_scan", { workspaceId, operationId });
export const filterEditorOpenPaths = (request: EditorScanRequest) => editorCommand<string[]>("editor_filter_open_paths", { request });
export const beginEditorFileOperation = (workspaceId: string) => editorCommand<string>("editor_begin_file_operation", { workspaceId });
export const cancelEditorFileOperation = (workspaceId: string, operationId: string) => editorCommand<void>("editor_cancel_file_operation", { workspaceId, operationId });
export const mutateEditorFiles = (workspaceId: string, operationId: string, action: import("../models/editor").EditorFileAction) => editorCommand<import("../models/editor").EditorFileMutationResult[]>("editor_mutate_files", { request: { workspaceId, operationId, action } });
export const previewEditorDelete = (workspaceId: string, path: string) => editorCommand<import("../models/editor").EditorDeletePreview>("editor_delete_preview", { workspaceId, path });

export const readEditorImage = (workspaceId: string, path: string) => editorCommand<{ dataUrl: string }>("editor_read_image", { workspaceId, path });

export const detachEditorWorkspace = (workspaceId: string, reference: import("../editor/layoutReferences").EditorWorkspaceReference) => editorCommand<{ workspace: import("../models/workspace").DetachedWorkspace; handoffId: string }>("editor_detach_workspace", { workspaceId, reference });
export const editorHandoffReady = (handoffId: string, ready: boolean) => editorCommand<void>("editor_handoff_ready", { handoffId, ready });
export const waitEditorHandoff = (handoffId: string, release: boolean) => editorCommand<boolean>("editor_wait_handoff", { handoffId, release });
export const finishEditorHandoff = (handoffId: string, commit: boolean) => editorCommand<void>("editor_finish_handoff", { handoffId, commit });

// Serialize focus updates so a late blur cannot overwrite the next focus context.
let nativeContextTail: Promise<unknown> = Promise.resolve();
export function setNativeEditorContext(active: boolean, menus: NativeEditorMenuItem[] = [], textInput = false): Promise<void> {
  const next = nativeContextTail.catch(() => {}).then(() => editorCommand<void>("editor_set_native_context", { active, menus, textInput }));
  nativeContextTail = next;
  return next;
}
