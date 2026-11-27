import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { FileBrowser } from "../../src/sftp/FileBrowser";
import { useEditorSettings } from "../../src/settings/useEditorSettings";
import { EditorWorkbench } from "../../src/editor/EditorWorkbench";
import { openEditorWorkspace } from "../../src/services/editorService";
import type { EditorOpenRequest, EditorWorkspace } from "../../src/models/editor";
import "../../src/theme/global.css";
const calls: string[] = [];
const opened: Array<{ source: string; path: string; directory: boolean; rootPath?: string }> = [];
const entry = (name: string, root: string, isDir = false) => ({ name, path: `${root}/${name}`, isDir, isSymlink: false, size: 32, modified: null });
mockWindows("main");
mockIPC((command, args) => {
  calls.push(command);
  if (command === "editor_set_native_context") return;
  if (command === "plugin:event|listen") return 1;
  if (command === "plugin:event|unlisten") return;
  if (command === "sftp_home") return "/remote";
  if (command === "sftp_local_home") return "/local";
  if (command === "sftp_local_roots") return [{ path: "/", label: "/" }];
  if (command === "sftp_list") return { path: "/remote", entries: [entry("remote-folder", "/remote", true), entry("remote-only.txt", "/remote"), entry("readme.md", "/remote"), entry("photo.png", "/remote")] };
  if (command === "sftp_local_list") return { path: "/local", entries: [entry("local-folder", "/local", true), entry("local-only.txt", "/local")] };
  if (command === "editor_open_workspace") { const request = args?.request as EditorOpenRequest; return { id: "directory-editor", source: request.source, rootPath: request.path, initialFile: null }; }
  if (command === "editor_list") return { path: args?.path, entries: [entry("inside.txt", args?.path as string)] };
  if (command === "sftp_read_image") return { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" };
  throw new Error(`Unexpected fixture command: ${command} (${Object.keys(args ?? {}).join(",")})`);
});
Object.assign(window, { legacyEditorFixture: { calls, opened } });
function Fixture() {
  const [workspace, setWorkspace] = useState<EditorWorkspace>();
  const settings = useEditorSettings("monospace", 14);
  return <main style={{ height: "100vh", display: "flex" }}>{workspace ? <EditorWorkbench workspace={workspace} title="directory" active locked={false} options={settings.options} onOpenFolder={() => {}} /> : <FileBrowser profileId="synthetic-profile" tabId="fixture" editorOptions={settings.options} onOpenEditor={(source, path, directory, rootPath) => {
    opened.push({ source, path, directory, rootPath });
    if (new URLSearchParams(location.search).has("workbench")) void openEditorWorkspace({ source: source === "local" ? { kind: "local" } : { kind: "sftp", profileId: "synthetic-profile" }, path, directory, rootPath }).then(setWorkspace);
  }} />}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
