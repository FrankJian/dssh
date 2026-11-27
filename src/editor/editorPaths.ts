import type { EditorWorkspace, FileSource } from "../models/editor.ts";
import { isWindowsLocalPath, localParent, remoteParent } from "../sftp/browserPaths.ts";
export function editorBaseName(source: FileSource, path: string): string {
  return path.split(source.kind === "local" && isWindowsLocalPath(path) ? /[\\/]/ : /\//).filter(Boolean).pop() || path;
}
export function editorParentPath(source: FileSource, path: string): string { return (source.kind === "local" ? localParent : remoteParent)(path); }
export function editorWithinRoot(source: FileSource, path: string, root: string): boolean {
  const windows = source.kind === "local" && isWindowsLocalPath(root);
  const normalize = (value: string) => (windows ? value.replace(/\//g, "\\") : value).replace(windows ? /\\+$/ : /\/+$/, "");
  const parent = normalize(root); const candidate = normalize(path);
  return candidate === parent || candidate.startsWith(`${parent}${windows ? "\\" : "/"}`);
}

export function canReuseEditorWorkspace(workspace: EditorWorkspace, source: FileSource, path: string, contextRoot?: string): boolean {
  return (!contextRoot || workspace.rootPath === contextRoot)
    && workspace.source.kind === source.kind
    && (source.kind === "local" || (workspace.source.kind === "sftp" && workspace.source.profileId === source.profileId))
    && (workspace.initialFile === path || (!!workspace.rootPath && editorWithinRoot(source, path, workspace.rootPath)));
}
