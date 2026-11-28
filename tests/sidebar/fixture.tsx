/** Production App with synthetic IPC. Isolated localhost origin; no host/file access. */
import { createRoot } from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import "../../src/theme/global.css";
const query = new URLSearchParams(location.search);
localStorage.setItem("dssh.navigation.icons.v3", JSON.stringify(["sessions", "connections", "tools", "sftp", "s3", "artifactory", "editor", "browser", "assistant"]));
if (query.has("theme")) localStorage.setItem("dssh.theme", query.get("theme")!);
if (query.has("color")) localStorage.setItem("dssh.app.paletteColor", query.get("color")!);
if (query.has("reset")) { localStorage.removeItem("dssh.sidebar.collapsed"); localStorage.removeItem("dssh.editor.workspaces.v1"); }
let browser: { id: string; owner: string; title: string; url: string; loading: boolean } | null = null;
const issue = (message: string) => {
  let report = document.getElementById("fixture-error");
  if (!report) { report = document.createElement("pre"); report.id = "fixture-error"; Object.assign(report.style, { position: "fixed", bottom: "0", right: "0", zIndex: "99999", color: "#fff", background: "#8b2323", maxWidth: "80vw" }); document.body.append(report); }
  report.textContent += `${message}\n`;
};
window.addEventListener("error", e => issue(e.message));
window.addEventListener("unhandledrejection", e => issue(String(e.reason)));
mockWindows("main");
mockIPC((command, args) => {
  if (command === "list_system_font_families") return ["Fixture Mono"];
  if (command === "list_jumpserver_profiles") return [{ id: "fixture-jms", name: "JumpServer 验收", coreUrl: "https://fixture.invalid", keyId: "", orgId: "fixture", hasCredential: false, authKind: "password", username: "fixture", sshProfileId: null }];
  if (command === "jumpserver_identity") return { userId: "fixture", username: "fixture", orgId: "fixture", generation: "fixture-generation" };
  if (command === "jumpserver_list_nodes") return { results: [{ id: "fixture-node", name: "验收目录", key: "1" }], count: 1, hasMore: false };
  if (command === "jumpserver_list_assets") return { results: [], count: 0, hasMore: false };
  if (command === "plugin:window|scale_factor") return 1;
  if (command === "plugin:window|inner_size") return { width: 1280, height: 800 };
  if (command === "plugin:window|is_maximized") return false;
  if (command === "get_app_lock_status") return { locked: false, settings: { enabled: false, hasPassword: false, autoLockEnabled: false, timeoutMinutes: 15 } };
  if (["list_ssh_profiles", "list_ssh_credentials", "list_terminal_sessions", "list_ssh_sessions", "list_sessions", "list_detached_workspaces", "list_rdp_profiles", "list_rdp_sessions", "list_smb_profiles", "list_jumpserver_profiles", "list_s3_profiles", "list_artifactory_profiles", "artifactory_list_transfers", "ai_load_providers", "ai_list_conversations"].includes(command)) return [];
  if (["plugin:event|unlisten", "editor_set_native_context", "editor_unwatch_files", "record_app_activity", "set_window_effects", "resize_browser", "mount_browser", "close_editor_workspace", "editor_close_workspace"].includes(command)) return;
  if (command === "ai_create_conversation") return { id: "fixture-conversation", title: "新对话", items: [], draft: "", selection: null };
  if (command === "rdp_engine_status") return { available: false, reason: "Synthetic UI fixture" };
  if (command === "list_browser_tabs") return { revision: 1, tabs: browser ? [browser] : [], activeId: browser?.id ?? null };
  if (command === "open_browser") {
    browser = { id: "fixture-browser", owner: "main", title: "浏览器", url: "about:blank", loading: false };
    void emit("browser://tabs-changed", { revision: 2, tabs: [browser], activeId: browser.id });
    return browser;
  }
  if (command === "editor_open_workspace") {
    const request = args?.request as { source: object; path?: string; directory?: boolean };
    return { id: `fixture-editor-${Date.now()}`, source: request.source, rootPath: request.directory ? request.path ?? null : null, initialFile: request.directory ? null : request.path ?? null };
  }
  if (command === "plugin:dialog|open") return "/fixture";
  if (command === "editor_list") return { path: args?.path, entries: [{ name: "example.txt", path: "/fixture/example.txt", isDir: false, isSymlink: false, size: 14, modified: null }] };
  if (command === "editor_watch_files") return "fixture-watch";
  if (command === "editor_read_text") return { source: { kind: "local" }, path: (args?.request as { path: string }).path, content: "Hello sidebar\n", encoding: "utf-8", lineEnding: "lf", bom: false, readOnly: false, versionToken: "fixture-v1" };
  if (command === "editor_inspect_file") return { source: { kind: "local" }, path: args?.path, versionToken: "fixture-v1", readOnly: false, byteLength: 14 };
  issue(command); throw new Error(`Unexpected fixture IPC: ${command}`);
}, { shouldMockEvents: true });
const { default: App } = await import("../../src/app/App");
createRoot(document.getElementById("root")!).render(<App />);

// Read-only frame evidence after a real user click; never drives application state.
if (query.has("motion")) {
  let revision = 0;
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-sidebar-details-toggle]")) return;
    const run = ++revision;
    const root = [...document.querySelectorAll<HTMLElement>(".sidebar-motion, .app-shell")]
      .find(node => node.getClientRects().length && (node.classList.contains("sidebar-motion") || !!node.querySelector(".side-dock__content")));
    if (!root) return;
    const property = root.classList.contains("app-shell") ? "--workspace-sidebar-progress" : "--sidebar-details-progress";
    const label = event.target.closest("button")?.getAttribute("aria-label") ?? "sidebar";
    const surface = root.matches(".app-shell") ? root.querySelector<HTMLElement>(".side-dock") : root.matches(".editor-sidebar-dock") ? root : root.querySelector<HTMLElement>(".tools-workspace__catalog, .artifactory-sidebar, .jumpserver__nodes, .session-manager__nav, .terminal-file-layout__tree");
    const parentStyle = surface?.parentElement ? getComputedStyle(surface.parentElement) : null;
    const vertical = parentStyle?.flexDirection === "column" || (parentStyle?.display === "grid" && !parentStyle.gridTemplateColumns.includes(" "));
    const extents: number[] = [];
    const target = label.startsWith("展开") ? 1 : 0;
    const values: number[] = [];
    const start = performance.now();
    const sample = () => {
      if (run !== revision) return;
      values.push(Number.parseFloat(getComputedStyle(root).getPropertyValue(property)));
      const rect = surface?.getBoundingClientRect();
      if (rect) extents.push(vertical ? rect.height : rect.width);
      const elapsed = performance.now() - start;
      if (elapsed < 240 || (Math.abs(values.at(-1)! - target) > 0.001 && elapsed < 1000)) { requestAnimationFrame(sample); return; }
      let report = document.getElementById("motion-report");
      if (!report) { report = document.createElement("output"); report.id = "motion-report"; report.setAttribute("aria-label", "过渡帧证据"); Object.assign(report.style, {position:"fixed",bottom:"0",right:"0",zIndex:"99999",background:"var(--bg-panel)",color:"var(--text-base)",padding:"8px",pointerEvents:"none"}); document.body.append(report); }
      report.textContent = `${label}：中间帧 ${values.filter(value => value > 0 && value < 1).length}，结束进度 ${values.at(-1)?.toFixed(2)}，尺寸采样 ${new Set(extents.map(value => value.toFixed(1))).size}，最终尺寸 ${extents.at(-1)?.toFixed(1)}px，减少动态效果 ${matchMedia("(prefers-reduced-motion: reduce)").matches}`;
    };
    requestAnimationFrame(sample);
  }, true);
}
