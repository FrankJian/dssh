// Server-render production components; no browser automation or native APIs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
const cacheDir = await mkdtemp(join(tmpdir(), "dssh-sidebar-ssr-"));
const server = await createServer({ cacheDir, server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error" });
const load = path => server.ssrLoadModule(`/src/${path}`);
try {
  const { AppLayout } = await load("app/AppLayout.tsx");
  const { ActivityBar } = await load("app/ActivityBar.tsx");
  const { useSidebarDetails } = await load("app/useSidebarDetails.ts");
  const { SessionManager } = await load("ssh/SessionManager.tsx");
  const { ToolsWorkspace } = await load("tools/ToolsWorkspace.tsx");
  const { ArtifactoryWorkspace } = await load("artifactory/ArtifactoryWorkspace.tsx");
  const { EditorSidebar } = await load("editor/EditorSidebar.tsx");
  const { TerminalFileLayout } = await load("terminal/TerminalFileLayout.tsx");
  const noop = () => {};
  const railProps = { activeActivity: "sessions", visibleNavigationIcons: ["sessions", "connections", "tools", "sftp", "s3", "artifactory", "editor", "browser"], sidebarCollapsed: false, onToggleSidebar: noop, onSelectActivity: noop, rightPanel: null, onToggleRightPanel: noop, onOpenEditor: noop, onOpenBrowser: noop, onOpenSettings: noop, onNewLocalTerminal: noop };
  await test("details button precedes every navigation icon, including with no configurable icons", () => {
    for (const visibleNavigationIcons of [railProps.visibleNavigationIcons, []]) {
      const html = renderToStaticMarkup(createElement(ActivityBar, { ...railProps, visibleNavigationIcons }));
      assert.match(html.match(/<button[^>]+>/)[0], /data-sidebar-details-toggle/);
      assert.match(html, /aria-expanded="true"/);
      assert.equal((html.match(/data-sidebar-details-toggle/g) ?? []).length, 1);
    }
  });
  await test("owner labels, disabled browser and feature selection are independent of collapse", () => {
    for (const sidebarContext of ["sessions", "connections", "tools", "sftp", "s3", "artifactory", "editor", "files", null]) {
      for (const sidebarCollapsed of [true, false]) {
        const html = renderToStaticMarkup(createElement(ActivityBar, { ...railProps, sidebarContext, sidebarCollapsed }));
        const first = html.match(/<button[^>]+>/)[0];
        assert.equal(first.includes('disabled=""'), sidebarContext === null);
        if (sidebarContext !== null) assert.ok(first.includes(`aria-expanded="${!sidebarCollapsed}"`));
        assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
      }
    }
  });
  await test("shared preference initializes every actual surface without implicitly opening it", () => {
    function State({ activity, editor, browser }) {
      const state = useSidebarDetails(activity, editor, browser);
      return createElement("output", { "data-collapsed": state.collapsed, "data-context": state.context ?? "none" });
    }
    for (const collapsed of [true, false]) {
      store.set("dssh.sidebar.collapsed", String(collapsed));
      for (const activity of ["sessions", "connections", "tools", "sftp", "s3", "artifactory"]) {
        for (const [editor, browser] of [[false, false], [true, false], [false, true]]) {
          const html = renderToStaticMarkup(createElement(State, { activity, editor, browser }));
          assert.ok(html.includes(`data-collapsed="${collapsed}"`));
        }
      }
    }
  });
  function assertIsolated(html, className, closed) {
    const tag = html.match(new RegExp(`<[^>]+class="${className}[^\"]*"[^>]*>`))?.[0];
    assert.ok(tag, className);
    assert.equal(tag.includes('inert=""'), closed, className);
    assert.ok(tag.includes(`aria-hidden="${closed}"`), className);
    assert.ok(!/\shidden(?:=|\s|>)/.test(tag), "display:none must not skip the transition");
  }
  await test("embedded navigation stays mounted and inert during collapse; controlled mode has no duplicate reveal", () => {
    for (const sidebarVisible of [true, false]) {
      const session = renderToStaticMarkup(createElement(SessionManager, { sidebarVisible, profiles: [], recentIds: [], recentLimit: 10, activeSessionCount: 0, isLoading: false, errorMessage: null }));
      assertIsolated(session, "session-manager__nav", !sidebarVisible);
      const tools = renderToStaticMarkup(createElement(ToolsWorkspace, { sidebarVisible, active: true, selected: "json-format", onSelect: noop }));
      assertIsolated(tools, "tools-workspace__catalog", !sidebarVisible);
      const artifacts = renderToStaticMarkup(createElement(ArtifactoryWorkspace, { sidebarVisible }));
      assertIsolated(artifacts, "artifactory-sidebar", !sidebarVisible);
      const editor = renderToStaticMarkup(createElement(EditorSidebar, { visible: sidebarVisible, disabled: !sidebarVisible, onCollapse: noop }, "tree"));
      assertIsolated(editor, "editor-sidebar-dock", !sidebarVisible);
      const files = renderToStaticMarkup(createElement(TerminalFileLayout, { sidebarVisible, onSidebarVisibleChange: noop, fileTree: "tree", terminal: "shell" }));
      assertIsolated(files, "terminal-file-layout__tree", !sidebarVisible);
      assert.ok(!files.includes("terminal-file-layout__reveal"));
    }
  });
  await test("shell collapse keeps the same sidebar content and grid tracks while isolating interaction", () => {
    globalThis.window = { innerWidth: 1280, innerHeight: 800 };
    const render = (sidebarVisible) => renderToStaticMarkup(createElement(AppLayout, {
      titleBar: null, activityBar: "rail", sidebar: createElement("input", { "aria-label": "retained-sidebar-input" }), sidebarVisible,
      main: "main", sidebarWidth: 288, rightPanelWidth: 360, onSidebarWidthChange: noop, onRightPanelWidthChange: noop,
    }));
    const open = render(true), closed = render(false);
    for (const html of [open, closed]) assert.ok(html.includes("retained-sidebar-input"));
    assertIsolated(open, "side-dock", false); assertIsolated(closed, "side-dock", true);
    assert.equal(open.match(/grid-template-columns:([^;]+)/)?.[1], closed.match(/grid-template-columns:([^;]+)/)?.[1]);
  });
} finally { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
