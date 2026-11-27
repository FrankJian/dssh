import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { open as chooseLocalDirectory } from "@tauri-apps/plugin-dialog";
import { localParent, remoteParent } from "../sftp/browserPaths";
import { isWindows } from "../platform";
import { beginEditorFileOperation, cancelEditorFileOperation, mutateEditorFiles, previewEditorDelete } from "../services/editorService";
import type { SftpEntry } from "../services/sftpService";
import type { EditorFileAction, EditorWorkspace } from "../models/editor";
import { EditorContextMenu, type EditorMenuAnchor } from "./EditorContextMenu";
import { EditorActionMenu, type EditorMenuItem } from "./EditorActionMenu";
import { useEditorDialogs } from "./useEditorDialogs";
import { performFileMutation, type FileOperationsApi } from "./fileOperations";
import type { MonacoDocuments } from "./MonacoDocumentView";
import type { ClosePlan, EditorActions } from "./editorActions";
import type { editor } from "monaco-editor";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/Icon";
const defaultApi: FileOperationsApi = { begin: beginEditorFileOperation, cancel: cancelEditorFileOperation, mutate: mutateEditorFiles, preview: previewEditorDelete };
export interface EditorFileManagementHandle {
  context(entries: SftpEntry[], anchor: EditorMenuAnchor): void;
  create(kind: "createFile" | "createDirectory", entries: SftpEntry[]): void;
  menuItems(): EditorMenuItem[];
}
export function EditorFileManagement({ workspace, selected, registry, actions, enabled, commitClose, onChanged, onCreated, onOpen, onBusy, ref, showTrigger = true, api = defaultApi }: {
  workspace: EditorWorkspace; selected: SftpEntry[]; registry: MonacoDocuments; actions: EditorActions<editor.ITextModel, editor.ICodeEditorViewState>;
  showTrigger?: boolean; ref?: Ref<EditorFileManagementHandle>; onCreated?(path: string, directory: boolean): void; onOpen?(path: string): void;
  enabled: boolean; commitClose(plan: ClosePlan): Promise<boolean>; onChanged(): void; onBusy(busy: boolean): void; api?: FileOperationsApi;
}) {
  const [context, setContext] = useState<{ entries: SftpEntry[]; anchor: EditorMenuAnchor } | null>(null);
  const dialogs = useEditorDialogs("文件操作"); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null); const operationId = useRef<string | null>(null); const allowed = useRef(enabled); allowed.current = enabled;
  const alive = useRef(true);
  const cancel = () => { controller.current?.abort(); const id = operationId.current; if (id) void api.cancel(workspace.id, id).catch(() => {}); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, [workspace.id]);
  useEffect(() => { if (!enabled) { cancel(); dialogs.cancel(); setContext(null); } }, [enabled]);
  const parentFor = (targets: SftpEntry[]) => targets.length === 1 ? targets[0].isDir && !targets[0].isSymlink ? targets[0].path : (workspace.source.kind === "local" ? localParent : remoteParent)(targets[0].path) : workspace.rootPath;
  useImperativeHandle(ref, () => ({
    context: (entries, anchor) => { if (allowed.current && !busy) setContext({ entries, anchor }); },
    create: (kind, entries) => { void perform(kind, entries); },
    menuItems: () => menuItems(selected).map((item) => ({ ...item, disabled: !enabled || busy || item.disabled })),
  }));
  async function perform(kind: EditorFileAction["kind"], targets = selected) {
    const parent = parentFor(targets);
    if (!allowed.current || busy) return;
    const next = new AbortController(); controller.current = next; setBusy(true); onBusy(true); setFeedback(null); setFailed(false);
    let created: { path: string; directory: boolean } | undefined;
    try {
      let action: EditorFileAction;
      if (kind === "createFile" || kind === "createDirectory") {
        if (!parent) return; const name = await dialogs.path(kind === "createFile" ? "新建文件" : "新建目录", ""); if (!name) return; action = { kind, parentPath: parent, name };
      } else if (kind === "rename") {
        if (targets.length !== 1) return; const name = await dialogs.path("重命名", targets[0].name); if (!name || name === targets[0].name) return; action = { kind, path: targets[0].path, name };
      } else if (kind === "move" || kind === "copy") {
        const target = workspace.source.kind === "local" ? await chooseLocalDirectory({ directory: true, multiple: false, defaultPath: workspace.rootPath ?? undefined }) : await dialogs.path(kind === "move" ? "移动到目录" : "复制到目录", workspace.rootPath ?? "/");
        if (typeof target !== "string") return; action = { kind, paths: targets.map((item) => item.path), targetDirectory: target };
      } else { action = { kind: "delete", paths: targets.map((item) => item.path) }; }
      const results = await performFileMutation({ workspace, registry, actions, action, api, windowsPaths: workspace.source.kind === "local" && isWindows, signal: next.signal,
        allowed: () => alive.current && allowed.current, choose: dialogs.choose, commitClose, started: (id) => { operationId.current = id; } });
      if (alive.current && results) { setFailed(results.some((item) => item.status !== "success")); setFeedback(results.map((item) => `${item.path}：${item.status === "success" ? "完成" : item.message ?? "未完成"}`).join("\n")); onChanged();
        if ((action.kind === "createFile" || action.kind === "createDirectory") && results[0]?.status === "success") created = { path: results[0].destination ?? results[0].path, directory: action.kind === "createDirectory" };
      }
    } catch (error) { if (alive.current && !next.signal.aborted) { setFailed(true); setFeedback(error instanceof Error ? error.message : "文件操作失败。"); } }
    finally { operationId.current = null; if (alive.current) { setBusy(false); onBusy(false); if (created) onCreated?.(created.path, created.directory); } }
  }
  async function copyPath(relative: boolean, targets = selected) {
    if (!allowed.current || busy) return;
    const root = workspace.rootPath ?? "";
    const windows = workspace.source.kind === "local" && isWindows;
    const parent = root.replace(windows ? /[\\/]$/ : /\/$/, "");
    const paths = targets.map((item) => relative && root && item.path.startsWith(`${parent}${windows ? "\\" : "/"}`) ? item.path.slice(parent.length + 1) : item.path);
    try { await navigator.clipboard.writeText(paths.join("\n")); } catch { setFailed(true); setFeedback("复制路径失败，请检查剪贴板权限。"); }
  }
  function menuItems(targets: SftpEntry[], contextMenu = false): EditorMenuItem[] {
    const parent = parentFor(targets);
    const command = (kind: EditorFileAction["kind"]) => () => { void perform(kind, targets); };
    return [
      ...(contextMenu && targets.length === 1 && !targets[0].isDir ? [{ id: "open", label: "打开文件", icon: "fileInput" as const, disabled: targets.length !== 1 || targets[0].isDir, run: () => { if (targets[0] && !targets[0].isDir) onOpen?.(targets[0].path); } }] : []),
      { id: "new-file", label: "新建文件", icon: "filePlus", section: "创建", disabled: !parent, run: command("createFile") },
      { id: "new-directory", label: "新建目录", icon: "folderPlus", section: "创建", disabled: !parent, run: command("createDirectory") },
      { id: "rename", label: "重命名", icon: "edit", section: "文件", disabled: targets.length !== 1, run: command("rename") },
      { id: "move", label: "移动到目录…", icon: "fileInput", section: "文件", disabled: !targets.length, run: command("move") },
      { id: "copy", label: "复制到目录…", icon: "copy", section: "文件", disabled: !targets.length, run: command("copy") },
      { id: "absolute", label: "复制绝对路径", icon: "copy", section: "路径", disabled: !targets.length, run: () => void copyPath(false, targets) },
      { id: "relative", label: "复制相对路径", icon: "copy", section: "路径", disabled: !targets.length, run: () => void copyPath(true, targets) },
      { id: "delete", label: "删除…", icon: "trash", section: "管理", danger: true, disabled: !targets.length, run: command("delete") },
    ];
  }
  return <div className="editor-file-management">{showTrigger ? <EditorActionMenu label="文件操作" icon="folderPlus" disabled={!enabled || busy} items={() => menuItems(selected)} /> : null}{busy ? <IconButton label="停止文件操作" onClick={cancel}><Icon name="stop" /></IconButton> : null}
  {feedback ? <details className="editor-file-management__feedback" open={failed}><summary aria-label="文件操作结果" title="文件操作结果"><Icon name={failed ? "info" : "check"} width="16" height="16" /></summary><pre role="status">{feedback}</pre></details> : null}{context && enabled && !busy ? <EditorContextMenu anchor={context.anchor} items={menuItems(context.entries, true)} onClose={() => setContext(null)} /> : null}{dialogs.dialog}</div>;
}
