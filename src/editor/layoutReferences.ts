import type { EditorLayout } from "./groupLayout.ts";
import { editorGroups, MAX_EDITOR_GROUPS } from "./groupLayout.ts";
import type { EditorOpenRequest, FileSource } from "../models/editor.ts";
export interface EditorViewLocation { path: string; line: number; column: number; scrollTop: number; scrollLeft: number }
export interface EditorLayoutReference { layout: EditorLayout; focused: string; locations: Record<string, EditorViewLocation> }
export interface EditorWorkspaceReference { source: FileSource; rootPath: string | null; initialFile: string | null; title: string; state: EditorLayoutReference }
export function initialEditorFile(state: EditorLayoutReference): string | null {
  const groups = editorGroups(state.layout);
  return groups.find((group) => group.id === state.focused)?.active ?? groups.flatMap((group) => group.documents)[0] ?? null;
}
export function editorRestoreRequest(reference: EditorWorkspaceReference): EditorOpenRequest {
  return { source: reference.source, path: reference.rootPath ?? initialEditorFile(reference.state) ?? reference.initialFile ?? undefined, directory: Boolean(reference.rootPath) };
}
const validPath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8192 && !/[\0-\x1f]/.test(value);
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1e9, value)) : fallback;
/** Whitelist fields: arbitrary storage/IPC objects can never carry bodies or credentials. */
export function parseEditorLayoutReference(input: unknown): EditorLayoutReference | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  let groups = 0; let nodes = 0; let files = 0;
  const ids = new Set<string>();
  function parse(input: unknown, depth: number): EditorLayout | null {
    if (!input || typeof input !== "object" || depth > MAX_EDITOR_GROUPS || ++nodes > MAX_EDITOR_GROUPS * 2 - 1) return null;
    const node = input as Record<string, unknown>;
    if (typeof node.id !== "string" || !/^[\w-]{1,100}$/.test(node.id) || ids.has(node.id)) return null;
    ids.add(node.id);
    if (node.kind === "group") {
      if (++groups > MAX_EDITOR_GROUPS || !Array.isArray(node.documents) || !node.documents.every(validPath)) return null;
      const documents = [...new Set(node.documents as string[])]; files += documents.length; if (files > 100) return null;
      return { kind: "group", id: node.id, documents, active: documents.includes(node.active as string) ? node.active as string : documents[0] ?? null,
        preview: documents.includes(node.preview as string) ? node.preview as string : null };
    }
    if (node.kind !== "split" || !["horizontal", "vertical"].includes(node.direction as string) || !Array.isArray(node.children) || node.children.length !== 2) return null;
    const a = parse(node.children[0], depth + 1); const b = parse(node.children[1], depth + 1);
    return a && b ? { kind: "split", id: node.id, direction: node.direction as "horizontal" | "vertical", ratio: Math.max(0.1, Math.min(0.9, number(node.ratio, 0.5))), children: [a, b] } : null;
  }
  const layout = parse(value.layout, 0); if (!layout) return null;
  const leaves = editorGroups(layout); const locations: Record<string, EditorViewLocation> = {};
  for (const group of leaves) {
    const location = (value.locations as Record<string, EditorViewLocation> | undefined)?.[group.id];
    if (location && group.documents.includes(location.path)) locations[group.id] = { path: location.path, line: Math.trunc(Math.max(1, number(location.line, 1))), column: Math.trunc(Math.max(1, number(location.column, 1))), scrollTop: number(location.scrollTop), scrollLeft: number(location.scrollLeft) };
  }
  return { layout, focused: leaves.some((g) => g.id === value.focused) ? value.focused as string : leaves[0].id, locations };
}
export function mapEditorLayout(layout: EditorLayout, map: (id: string) => string | null): EditorLayout {
  if (layout.kind === "split") return { ...layout, children: [mapEditorLayout(layout.children[0], map), mapEditorLayout(layout.children[1], map)] };
  const documents = [...new Set(layout.documents.map(map).filter((path): path is string => !!path))];
  const active = layout.active ? map(layout.active) : null; const preview = layout.preview ? map(layout.preview) : null;
  return { ...layout, documents, active: active && documents.includes(active) ? active : documents[0] ?? null, preview: preview && documents.includes(preview) ? preview : null };
}
export function parseEditorWorkspaceReference(input: unknown): EditorWorkspaceReference | null {
  if (!input || typeof input !== "object") return null;
  const value = input as EditorWorkspaceReference;
  const source = value.source?.kind === "local" ? { kind: "local" as const } : value.source?.kind === "sftp" && typeof value.source.profileId === "string" && value.source.profileId.length <= 1024 ? { kind: "sftp" as const, profileId: value.source.profileId } : null;
  const state = parseEditorLayoutReference(value.state);
  if (!source || !state || (value.rootPath !== null && !validPath(value.rootPath)) || (value.initialFile !== null && !validPath(value.initialFile))) return null;
  return { source, rootPath: value.rootPath, initialFile: value.initialFile, title: typeof value.title === "string" ? value.title.slice(0, 200) : "编辑器", state };
}
export const EDITOR_WORKSPACES_KEY = "dssh.editor.workspaces.v1";
export function readEditorWorkspaceReferences(storage: Pick<Storage, "getItem">): EditorWorkspaceReference[] {
  try { const data = JSON.parse(storage.getItem(EDITOR_WORKSPACES_KEY) ?? "[]"); return Array.isArray(data) ? data.slice(0, 16).map(parseEditorWorkspaceReference).filter((item): item is EditorWorkspaceReference => !!item) : []; } catch { return []; }
}

const FOLDER_LAYOUT_PREFIX = "dssh.editor.folderLayout.v1:";
const folderLayoutKey = (source: FileSource, rootPath: string) => FOLDER_LAYOUT_PREFIX + JSON.stringify([source.kind, source.kind === "sftp" ? source.profileId : null, rootPath]);
/** Per-folder layout cache lets independent windows restore when the folder is reopened. */
export function storeEditorFolderLayout(storage: Pick<Storage, "setItem">, reference: EditorWorkspaceReference): void {
  const clean = parseEditorWorkspaceReference(reference);
  if (clean?.rootPath) storage.setItem(folderLayoutKey(clean.source, clean.rootPath), JSON.stringify(clean));
}
export function readEditorFolderLayout(storage: Pick<Storage, "getItem">, source: FileSource, rootPath: string): EditorWorkspaceReference | null {
  try {
    const reference = parseEditorWorkspaceReference(JSON.parse(storage.getItem(folderLayoutKey(source, rootPath)) ?? "null"));
    return reference && reference.rootPath === rootPath && reference.source.kind === source.kind && (source.kind === "local" || (reference.source.kind === "sftp" && reference.source.profileId === source.profileId)) ? reference : null;
  } catch { return null; }
}
