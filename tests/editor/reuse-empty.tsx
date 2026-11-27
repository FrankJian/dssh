import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { useWorkspace } from "../../src/app/useWorkspace";
import { EditorWorkbench, type EditorWorkbenchHandle } from "../../src/editor/EditorWorkbench";
import { EditorFileProvider } from "../../src/editor/fileProvider";
import { reuseEmptyEditorWorkspace } from "../../src/editor/reuseEmptyWorkspace";
import { chooseLocalEditorPath } from "../../src/editor/localEntry";
import { useEditorSettings } from "../../src/settings/useEditorSettings";
import type { FileSource, EditorWorkspace } from "../../src/models/editor";
import "../../src/theme/global.css";
const api = { selected: null as string | null, fail: false, deferFolder: false, deferRead: false, releaseFolder: () => {}, releaseRead: () => {}, opened: [] as string[], closed: [] as string[], handles: new Map<string, EditorWorkbenchHandle>(), openFolder: null as ((path: string, force?: boolean, source?: FileSource) => Promise<string>) | null, tabs: () => [] as ReturnType<typeof useWorkspace>["editorTabs"] };
Object.assign(window, { emptyEditorFixture: api });
mockWindows("main");
mockIPC((command) => { if (command === "plugin:dialog|open") { if (api.fail) throw new Error("合成选择失败"); return api.selected; } if (command === "editor_set_native_context" || command === "editor_unwatch_files") return; throw new Error(`Unexpected fixture command: ${command}`); });
let sequence = 0;
const providers = new Map<string, EditorFileProvider>();
function provider(workspace: EditorWorkspace) {
  if (!providers.has(workspace.id)) providers.set(workspace.id, new EditorFileProvider(workspace, {
    close: async () => {},
    list: async (_, path) => ({ path, entries: [{ name: "sample.txt", path: `${path}/sample.txt`, isDir: false, isSymlink: false, size: 10, modified: null, permissions: null }] }),
    image: async () => ({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" }),
    read: async ({ path }) => { if (api.deferRead) await new Promise<void>(resolve => { api.releaseRead = resolve; }); return { source: workspace.source, path, content: "synthetic document", encoding: "utf-8", lineEnding: "lf", bom: false, readOnly: false, versionToken: "synthetic-v1" }; },
    inspect: async (_, path) => ({ source: workspace.source, path, versionToken: "synthetic-v1", readOnly: false, byteLength: 10 }),
    save: async () => { throw new Error("fixture does not write files"); },
  }));
  return providers.get(workspace.id)!;
}
function Fixture() {
  const workspace = useWorkspace(); api.tabs = workspace.getEditorTabs;
  const settings = useEditorSettings("monospace", 14);
  const [locked, setLocked] = useState(false); const [handoff, setHandoff] = useState(false); const [error, setError] = useState("");
  const blocked = useRef(false); blocked.current = locked || handoff;
  function create() { return workspace.addEditorTab({ id: `blank-${++sequence}`, source: { kind: "local" }, rootPath: null, initialFile: null }, "文本编辑器"); }
  useEffect(() => { if (!workspace.getEditorTabs().length) create(); }, []);
  api.openFolder = async (path, force = false, source = { kind: "local" }) => {
    if (api.deferFolder) await new Promise<void>(resolve => { api.releaseFolder = resolve; });
    if (api.fail) throw new Error("合成目录打开失败");
    const next: EditorWorkspace = { id: `folder-${++sequence}`, source, rootPath: path, initialFile: null }; api.opened.push(next.id);
    if (blocked.current) { api.closed.push(next.id); return ""; }
    if (!force) {
      const existing = workspace.getEditorTabs().find(tab => tab.workspace.rootPath === path && JSON.stringify(tab.workspace.source) === JSON.stringify(source));
      if (existing) { api.closed.push(next.id); workspace.focusEditorTab(existing.id); return existing.id; }
      const reused = reuseEmptyEditorWorkspace({ tabs: workspace.getEditorTabs(), preferredId: workspace.activeEditorId, handles: api.handles, workspace: next, titleFor: () => path.split("/").pop()!, replace: workspace.replaceEditorTab });
      if (reused) { api.closed.push(reused.previousWorkspaceId); workspace.focusEditorTab(reused.id); return reused.id; }
    }
    return workspace.addEditorTab(next, path.split("/").pop()!);
  };
  async function choose() { try { await chooseLocalEditorPath(true, path => api.openFolder!(path)); } catch (error) { setError((error as Error).message); } }
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <nav><button onClick={() => void choose()}>选择目录</button><button onClick={create}>明确新建</button><button onClick={() => setLocked(v => !v)}>锁屏</button><button onClick={() => setHandoff(v => !v)}>交接</button></nav>
    <div role="tablist" aria-label="工作台">{workspace.editorTabs.map(tab => <button key={tab.id} data-id={tab.id} role="tab" aria-selected={workspace.activeEditorId === tab.id} onClick={() => workspace.focusEditorTab(tab.id)}>{tab.title}</button>)}</div>
    {error ? <div role="alert">{error}</div> : null}
    {workspace.editorTabs.map(tab => <div key={tab.id} hidden={workspace.activeEditorId !== tab.id} style={{ flex: 1, minHeight: 0 }}><EditorWorkbench key={tab.workspace.id} workspace={tab.workspace} provider={provider(tab.workspace)} title={tab.title} options={settings.options} active={workspace.activeEditorId === tab.id} locked={locked} handoffPending={handoff} ref={handle => { if (handle) api.handles.set(tab.id, handle); else api.handles.delete(tab.id); }} onOpenFolder={() => void choose()} /></div>)}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
