import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { LocalFileTree } from "../../src/sftp/LocalFileTree";
import { RemoteFileTree } from "../../src/sftp/RemoteFileTree";
import { EditorWorkbench } from "../../src/editor/EditorWorkbench";
import { openEditorWorkspace } from "../../src/services/editorService";
import { useEditorSettings } from "../../src/settings/useEditorSettings";
import type { EditorOpenRequest, EditorWorkspace, FileSource } from "../../src/models/editor";
import type { EditorLayoutReference } from "../../src/editor/layoutReferences";
import { editorRestoreRequest } from "../../src/editor/layoutReferences";
import "../../src/theme/global.css";

const query = new URLSearchParams(location.search);
const local = query.has("local");
const source: FileSource = local ? { kind: "local" } : { kind: "sftp", profileId: "fixture" };
const requests: EditorOpenRequest[] = [];
const startupErrors: string[] = [];
const entry = (name: string, parent: string, isDir = false) => ({ name, path: `${parent}/${name}`, isDir, isSymlink: false, size: 20, modified: null });
const listing = (path: string) => ({ path, entries: path === "/root" ? [entry("nested", path, true), entry("other.txt", path)] : [entry(".settings.txt", path), entry("sibling.txt", path)] });
mockWindows(query.has("detached") ? "detached-editor-fixture" : "main");
mockIPC((command, args) => {
  if (command === "plugin:window|scale_factor") return 1;
  if (command === "plugin:window|inner_size") return { width: 1280, height: 800 };
  if (command === "editor_set_native_context") return;
  if (command === "plugin:event|listen") return 1;
  if (command === "plugin:event|unlisten" || command === "editor_unwatch_files") return;
  if (command === "editor_watch_files") return "watch-fixture";
  if (command === "sftp_local_roots") return [{ path: "/", label: "/" }];
  if (command === "sftp_home" || command === "sftp_local_home") return "/root";
  if (["sftp_list", "sftp_local_list", "editor_list"].includes(command)) return listing(args?.path as string);
  if (command === "editor_open_workspace") {
    const request = args?.request as EditorOpenRequest; requests.push(request);
    if (query.has("startup") && !request.path && !request.directory) throw { code: "editor_path_type", message: "所选远程路径类型不正确。" };
    return { id: "session-editor", source: request.source, rootPath: request.rootPath ?? (request.directory ? request.path : null), initialFile: request.directory ? null : request.path };
  }
  if (command === "editor_read_text") {
    const request = args?.request as { path: string };
    return { source, path: request.path, content: `text from ${request.path}`, encoding: "utf-8", lineEnding: "lf", bom: false, readOnly: false, versionToken: "v1" };
  }
  if (command === "editor_inspect_file") return { source, path: args?.path, versionToken: "v1", readOnly: false, byteLength: 20 };
  throw new Error(`Unexpected session fixture command: ${command}`);
});
Object.assign(window, { sessionEntryFixture: { requests, startupErrors } });
const cached: EditorLayoutReference = { layout: { kind: "group", id: "cached", documents: ["/root/other.txt"], active: "/root/other.txt", preview: null }, focused: "cached", locations: {} };
const legacy = ["one.txt", "two.txt", "three.txt"].map((name) => ({ source, rootPath: null, initialFile: null, title: name, state: { ...cached, layout: { ...cached.layout, documents: [`/root/${name}`], active: `/root/${name}` } } }));
function Fixture() {
  const [workspace, setWorkspace] = useState<EditorWorkspace>();
  const started = useRef(false);
  useEffect(() => {
    if (!query.has("startup") || started.current) return;
    started.current = true;
    void (async () => { let last: EditorWorkspace | undefined; for (const reference of legacy) last = await openEditorWorkspace(editorRestoreRequest(reference)); setWorkspace(last); })().catch((error) => { startupErrors.push(error.message); });
  }, []);
  const settings = useEditorSettings("monospace", 14);
  const open = async (entry: { path: string }, rootPath: string) => setWorkspace(await openEditorWorkspace({ source, path: entry.path, directory: false, rootPath }));
  return <main style={{ height: "100vh", display: "flex" }}>
    {workspace ? <EditorWorkbench workspace={workspace} title="session directory" active locked={false} options={settings.options} onOpenFolder={() => {}}
      restore={query.has("startup") ? legacy[2].state : query.has("cached") ? cached : undefined} /> : <section style={{ width: 320, display: "flex" }}>
      {local ? <LocalFileTree activeFilePath={null} initialRootPath="/root" onClose={() => {}} onOpenFile={(entry, rootPath) => { void open(entry, rootPath); }} />
        : <RemoteFileTree profileId="fixture" activeFilePath={null} initialRootPath="/root" onClose={() => {}} onFileRemoved={() => {}} onFileRenamed={() => {}} onOpenFile={(entry, rootPath) => { void open(entry, rootPath); }} />}
    </section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
