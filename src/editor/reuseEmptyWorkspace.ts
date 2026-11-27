import type { EditorTab } from "../app/useWorkspace.ts";
import type { EditorWorkspace } from "../models/editor.ts";
import type { EditorLayoutReference } from "./layoutReferences.ts";

interface EmptyHandle { claimEmpty(): boolean; thaw(): void }

/** Claim and replace in one synchronous turn; async directory opening happens before this. */
export function reuseEmptyEditorWorkspace(options: {
  tabs: readonly EditorTab[];
  preferredId?: string | null;
  handles: ReadonlyMap<string, EmptyHandle>;
  workspace: EditorWorkspace;
  restore?: EditorLayoutReference;
  titleFor(tab: EditorTab): string;
  replace(id: string, expectedWorkspaceId: string, workspace: EditorWorkspace, title: string, restore?: EditorLayoutReference): boolean;
}): { id: string; previousWorkspaceId: string } | null {
  if (!options.workspace.rootPath) return null;
  const candidates = [...options.tabs].sort((a, b) => Number(b.id === options.preferredId) - Number(a.id === options.preferredId));
  for (const tab of candidates) {
    if (tab.workspace.rootPath || tab.workspace.initialFile) continue;
    const handle = options.handles.get(tab.id);
    if (!handle?.claimEmpty()) continue;
    try {
      if (options.replace(tab.id, tab.workspace.id, options.workspace, options.titleFor(tab), options.restore)) return { id: tab.id, previousWorkspaceId: tab.workspace.id };
    } catch (error) { handle.thaw(); throw error; }
    handle.thaw();
  }
  return null;
}
