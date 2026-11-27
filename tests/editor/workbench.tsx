import { ActivityBar } from "../../src/app/ActivityBar";
import { WorkspaceTabStrip } from "../../src/app/WorkspaceTabStrip";
import { editorWorkspaceLabels } from "../../src/editor/workspaceLabels";
import { Icon } from "../../src/ui/Icon";
import { useApplicationExit } from "../../src/editor/useApplicationExit";
import { prepareEditorWindowClose } from "../../src/editor/closeWorkspace";
import { useAppPalette } from "../../src/theme/useAppPalette";
import { useEditorSettings, type EditorSettings } from "../../src/settings/useEditorSettings";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { chooseLocalEditorPath } from "../../src/editor/localEntry";
import { EditorWorkbench, type EditorWorkbenchHandle } from "../../src/editor/EditorWorkbench";
import { EditorFileProvider } from "../../src/editor/fileProvider";
import { EditorFileError } from "../../src/services/editorService";
import type { EditorLayoutReference } from "../../src/editor/layoutReferences";
import type { EditorWorkspace, LoadedText } from "../../src/models/editor";
import { searchInWorker } from "../../src/editor/searchWorker";
import type { FileOperationsApi } from "../../src/editor/fileOperations";
import type { ScanApi } from "../../src/editor/searchRunner";
import { loadMonaco } from "../../src/sftp/monacoLoader";
import "../../src/theme/global.css";
const iconsFixture = new URLSearchParams(location.search).has("icons");
const nativeChromeFixture = new URLSearchParams(location.search).has("nativeChrome");
const chromeFixture = nativeChromeFixture || new URLSearchParams(location.search).has("chrome");
const localEntry = new URLSearchParams(location.search).has("local");
const nativeMenuContexts: boolean[] = [];
const nativeMenuModels: unknown[] = [];
const exitReplies: unknown[] = [];
const exitCommits: string[] = [];
const nativeMenuFixture = new URLSearchParams(location.search).has("nativeMenu");
if (nativeMenuFixture) Object.assign(globalThis, { isTauri: true });
const imageExports: number[][] = [];
const imageSave = { mode: "save" as "save" | "cancel" | "error" };
const imageResponses = new Map<string, string>(); const imageReads: string[] = [];
const nativeSelection: { path: string | null; fail: boolean; calls: Array<{ directory?: boolean }>; commands: string[]; folders: string[] } = { path: null, fail: false, calls: [], commands: [], folders: [] };
if (localEntry) {
  mockWindows("main");
  mockIPC((command, args) => {
    nativeSelection.commands.push(command);
    if (command === "plugin:dialog|open") {
      nativeSelection.calls.push(args?.options as { directory?: boolean });
      if (nativeSelection.fail) throw new Error("合成文件选择失败");
      return nativeSelection.path;
    }
    if (command === "plugin:dialog|save") { if (nativeSelection.fail) throw new Error("合成保存选择失败"); return nativeSelection.path; }
    if (command === "save_tool_png") {
      if (imageSave.mode === "error") throw new Error("合成图片保存失败");
      if (imageSave.mode === "cancel") return false;
      imageExports.push(Array.from(new Uint8Array(args as unknown as ArrayBuffer))); return true;
    }
    if (command === "application_exit_reply") { exitReplies.push(args); return; }
    if (command === "editor_set_native_context") { nativeMenuContexts.push(Boolean(args?.active)); nativeMenuModels.push(args); return; }
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten" || command === "editor_unwatch_files") return;
    if (command === "editor_watch_files") return "fixture-watch";
    throw new Error(`Unexpected local fixture command: ${command}`);
  }, { shouldMockEvents: nativeMenuFixture });
}
const workspace: EditorWorkspace = { id: "workbench-fixture", source: localEntry ? { kind: "local" } : { kind: "sftp", profileId: "fixture" }, rootPath: new URLSearchParams(location.search).has("emptyWorkspace") ? null : "/root", initialFile: null };
const files = new Map<string, LoadedText>(["a2.ts", "a10.ts", ".hidden", "nested/child.txt", "fail/retry.txt", ...(iconsFixture ? [".gitignore", ".gitattributes", "build.rs", "Cargo.lock", "Cargo.toml", "Info.plist", "tauri.conf.json", "AGENTS.md", "index.html", "package.json", "playwright.editor.config.ts", "pnpm-lock.yaml", "pnpm-workspace.yaml", "README.md", "TODO.md", "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "link.ts"] : [])].map((name) => [`/root/${name}`, { source: workspace.source, path: `/root/${name}`, content: `// ${name}\nconst value = 1;`, encoding: "utf-8", lineEnding: "lf", bom: false, readOnly: false, versionToken: "v1" }]));
const directories = new Set(["/root", "/root/nested", "/root/fail"]);
let denyList = true;
const reads: string[] = []; const writes: unknown[] = [];
const writeFailure = { enabled: false };
const provider = new EditorFileProvider(workspace, {
  close: async () => {},
  image: async (_, path) => { imageReads.push(path); return { dataUrl: imageResponses.get(path) ?? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" }; },
  list: async (_, path) => {
    reads.push(path);
    if (path === "/root/fail" && denyList) { denyList = false; throw new Error("读取目录失败"); }
    const names = [...files.keys(), ...directories].filter((item) => item.startsWith(`${path}/`)).map((item) => item.slice(path.length + 1).split("/")[0]);
    return { path, entries: [...new Set(names)].map((name) => ({ name, path: `${path}/${name}`, isDir: directories.has(`${path}/${name}`), isSymlink: iconsFixture && name === "link.ts", size: 20, modified: null, permissions: null })) };
  },
  read: async (request) => { const file = files.get(request.path); if (!file) throw new EditorFileError("editor_missing", "文件不存在"); if (file.largeFile && !request.allowLarge) throw new EditorFileError("editor_large_file", "超过普通预算"); return { ...file }; },
  inspect: async (_, path) => ({ source: workspace.source, path, versionToken: files.get(path)?.versionToken ?? null, readOnly: false, byteLength: 20 }),
  save: async (request) => {
    if (writeFailure.enabled) throw new EditorFileError("editor_io", "合成保存失败");
    if ((files.get(request.path)?.versionToken ?? null) !== request.expectedVersion) throw new EditorFileError("editor_conflict", "文件已变化");
    writes.push(request); const versionToken = `v${writes.length + 1}`;
    files.set(request.path, { ...request, source: workspace.source, readOnly: false, versionToken });
    return { source: workspace.source, path: request.path, versionToken };
  },
});
let scanSequence = 0;
const scans = new Map<string, { paths: string[]; index: number }>();
const scanApi: ScanApi = {
  filter: async (request) => request.skipPaths.filter((path) => path.startsWith("/root/") && (request.showHidden || !path.slice(6).split("/").some((part) => part.startsWith(".")))),
  start: async (request) => { const id = `scan-${++scanSequence}`; scans.set(id, { paths: [...files.keys()].filter((path) => !request.skipPaths.includes(path) && (request.showHidden || !path.slice(6).split("/").some((part) => part.startsWith(".")))), index: 0 }); return id; },
  next: async (_, id) => { const scan = scans.get(id)!; const path = scan.paths[scan.index++]; return { operationId: id, items: path ? [{ path, relativePath: path.slice(6), file: { ...files.get(path)! } }] : [], progress: { directories: 3, entries: scan.index, bytes: 100, unreadable: 0, binary: 0, encoding: 0, oversized: 0, links: 0, done: scan.index >= scan.paths.length, reason: null } }; },
  cancel: async (_, id) => { scans.delete(id); },
};
const mutationCalls: Array<{ kind: string; openModels: number }> = [];
const fileOperationsApi: FileOperationsApi = {
  begin: async () => `operation-${Date.now()}`,
  cancel: async () => {},
  preview: async (_, path) => { const paths = [...files.keys()].filter((name) => name === path || name.startsWith(`${path}/`)); return { path, paths, files: paths.length, directories: files.has(path) ? 0 : 1, symlinks: 0, truncated: false }; },
  mutate: async (_, __, action) => {
    mutationCalls.push({ kind: action.kind, openModels: monaco.editor.getModels().filter((model) => model.uri.scheme === "dssh-editor").length });
    const exists = (path: string) => files.has(path) || directories.has(path);
    if (action.kind === "delete") { for (const path of action.paths) { for (const name of [...files.keys()]) if (name === path || name.startsWith(`${path}/`)) files.delete(name); for (const name of [...directories]) if (name === path || name.startsWith(`${path}/`)) directories.delete(name); } return action.paths.map((path) => ({ path, destination: null, status: "success", message: null })); }
    if (action.kind === "createFile" || action.kind === "createDirectory") {
      const path = `${action.parentPath}/${action.name}`;
      if (exists(path)) throw new EditorFileError("editor_exists", "目标已存在同名项目");
      if (action.kind === "createFile") files.set(path, { ...files.get("/root/a2.ts")!, path, content: "" }); else directories.add(path);
      return [{ path: action.parentPath, destination: path, status: "success", message: null }];
    }
    const paths = action.kind === "rename" ? [action.path] : action.paths;
    return paths.map((path) => {
      const destination = action.kind === "rename" ? `${path.slice(0, path.lastIndexOf("/"))}/${action.name}` : `${action.targetDirectory}/${path.slice(path.lastIndexOf("/") + 1)}`;
      if (exists(destination)) return { path, destination: null, status: "failed" as const, message: "目标已存在同名项目" };
      for (const [name, file] of [...files]) if (name === path || name.startsWith(`${path}/`)) { const target = destination + name.slice(path.length); files.set(target, { ...file, path: target }); if (action.kind !== "copy") files.delete(name); }
      for (const name of [...directories]) if (name === path || name.startsWith(`${path}/`)) { directories.add(destination + name.slice(path.length)); if (action.kind !== "copy") directories.delete(name); }
      return { path, destination, status: "success" as const, message: null };
    });
  },
};
const monaco = await loadMonaco();
const api = { writeFailure, imageExports, imageSave, imageResponses, imageReads, visibility: null as ((value: boolean) => void) | null, detachRequests: 0, commandRequests: 0, exitReplies, exitCommits, nativeMenuContexts, nativeMenuModels, nativeSelection, chooseLocalEditorPath, palette: null as ReturnType<typeof useAppPalette> | null, handoff: null as ((value: boolean) => void) | null, restart: null as ((state: EditorLayoutReference) => void) | null, ready: [] as boolean[], directories, settings: null as EditorSettings | null, mutationCalls, searchInWorker, files, reads, writes, monaco, handle: null as EditorWorkbenchHandle | null, lock: null as ((value: boolean) => void) | null, closeResult: null as boolean | null };
Object.assign(window, { workbenchFixture: api });
function Fixture() {
  api.palette = useAppPalette();
  const [handoffPending, setHandoffPending] = useState(false); api.handoff = setHandoffPending;
  const settings = useEditorSettings("monospace", 14); api.settings = settings;
  const [locked, setLocked] = useState(false); api.lock = setLocked; const [visible, setVisible] = useState(true); const [closed, setClosed] = useState(false);
  const [restore, setRestore] = useState<EditorLayoutReference>(); const [generation, setGeneration] = useState(0);
  api.restart = (state) => { setRestore(state); setGeneration((n) => n + 1); };
  const [titlebarHost, setTitlebarHost] = useState<HTMLDivElement | null>(null);
  api.visibility = setVisible;
  const handle = useRef<EditorWorkbenchHandle>(null);
  useApplicationExit(async () => prepareEditorWindowClose({ editors: handle.current ? [handle.current] : [], allowed: () => !locked, confirmTerminals: async () => true, commit: async () => { exitCommits.push("release"); } }), () => handle.current?.cancelClose(), locked);
  const [chromeActive, setChromeActive] = useState(workspace.id);
  const chromeTabs = editorWorkspaceLabels([
    { id: "empty-a", title: "文本编辑器", workspace: { ...workspace, rootPath: null } },
    { id: "empty-b", title: "文本编辑器", workspace: { ...workspace, rootPath: null } },
    { id: workspace.id, title: "project", workspace },
  ]).map((item) => ({ ...item, sourceLabel: item.source, kind: "editor" as const, icon: "editor" as const, renameValue: item.title, active: item.id === chromeActive }));
  const allChromeTabs = [...chromeTabs, { id: "ssh-reference", kind: "ssh" as const, title: "118.31.169.7", active: chromeActive === "ssh-reference", icon: "connections" as const }];
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>{chromeFixture ? <header className={`titlebar${nativeChromeFixture ? " titlebar--editor" : ""}`}><div className="titlebar__workspace"><WorkspaceTabStrip tabs={allChromeTabs} onSelect={tab => setChromeActive(tab.id)} onDuplicate={() => {}} onRename={() => {}} onClose={() => {}} onCloseMany={() => {}} /></div>{nativeChromeFixture ? <div className="titlebar__editor-center" ref={setTitlebarHost} /> : null}<div className="titlebar__drag" /><button className="tab-action titlebar__new-terminal" aria-label="新建本地终端"><Icon name="plus" height="16" width="16" /></button><button className="tab-action titlebar__new-editor" aria-label="新建文本编辑器"><Icon name="editor" height="16" width="16" /></button></header> : <nav>
    <button onClick={() => setLocked((v) => !v)}>切换锁定</button><button onClick={() => setVisible((v) => !v)}>切换可见</button>
    <button onClick={async () => { const plan = await handle.current?.prepareClose(); api.closeResult = !!plan && !!handle.current?.validClose(plan); if (api.closeResult) setClosed(true); }}>关闭工作台</button>
  </nav>}<div style={{ display: "flex", flex: 1, minHeight: 0 }}>{chromeFixture ? <ActivityBar activeActivity="sessions" visibleNavigationIcons={["sessions", "connections", "editor"]} onSelectActivity={() => {}} sidebarCollapsed rightPanel={null} onToggleRightPanel={() => {}} onNewLocalTerminal={() => {}} onOpenSettings={() => {}} onOpenBrowser={() => {}} onOpenEditor={() => {}} /> : null}<div style={{ flex: 1, minHeight: 0, display: visible ? "flex" : "none" }}>{!closed && <EditorWorkbench nativeChrome={nativeChromeFixture} titlebarContainer={titlebarHost} onCommandPalette={new URLSearchParams(location.search).has("welcomeCommands") ? () => { api.commandRequests++; } : undefined} onDetach={() => { api.detachRequests++; }} key={generation} handoffPending={handoffPending} restore={restore} onReady={(ready) => api.ready.push(ready)} workspace={workspace} provider={provider} scanApi={scanApi} fileOperationsApi={fileOperationsApi} title="fixture" active={visible} locked={locked} options={settings.options} onPreferencesChange={(patch) => { if (patch.tabSize !== undefined) settings.setTabSize(patch.tabSize); if (patch.wordWrap !== undefined) settings.setWordWrap(patch.wordWrap === "on"); if (patch.renderWhitespace !== undefined) settings.setRenderWhitespace(patch.renderWhitespace); }} ref={(value) => { handle.current = value; api.handle = value; }} onOpenFolder={() => { if (localEntry) void chooseLocalEditorPath(true, (path) => { nativeSelection.folders.push(path); }); }} />}</div>{new URLSearchParams(location.search).has("multiMenu") ? <div style={{ display: visible ? "none" : "flex", flex: 1, minHeight: 0 }}><EditorWorkbench workspace={{ ...workspace, id: "second-editor" }} title="second editor" provider={provider} scanApi={scanApi} fileOperationsApi={fileOperationsApi} active={!visible} locked={locked} nativeChrome={nativeChromeFixture} titlebarContainer={titlebarHost} options={settings.options} /></div> : null}</div></main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
