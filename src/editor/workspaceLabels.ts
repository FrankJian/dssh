import type { EditorWorkspace } from "../models/editor.ts";
import { editorBaseName, editorParentPath } from "./editorPaths.ts";

/** Display context never overwrites a saved/user-edited workspace name. */
export function editorWorkspaceLabels(tabs: Array<{ id: string; title: string; workspace: EditorWorkspace }>) {
  return tabs.map((tab, index) => {
    const { workspace } = tab;
    const source = workspace.source.kind === "local" ? "本地" : "SSH";
    const path = workspace.rootPath ?? workspace.initialFile;
    const empty = !path && ["文本编辑器", "远程编辑器"].includes(tab.title);
    let title = empty ? `${tab.title} ${index + 1}` : tab.title;
    const peers = tabs.filter((item) => item.title === tab.title);
    if (!empty && peers.length > 1) {
      const parent = path ? editorBaseName(workspace.source, editorParentPath(workspace.source, path)) : "";
      const sameParent = peers.filter((item) => {
        const other = item.workspace.rootPath ?? item.workspace.initialFile;
        return other && editorBaseName(item.workspace.source, editorParentPath(item.workspace.source, other)) === parent;
      }).length > 1;
      title = parent && !sameParent ? `${tab.title} · ${parent}` : `${tab.title} · ${peers.indexOf(tab) + 1}`;
    }
    return { id: tab.id, title, source, description: `${source} · ${path ?? "空工作台"}` };
  });
}
