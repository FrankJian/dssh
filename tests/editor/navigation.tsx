import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActivityBar, type ActivityId } from "../../src/app/ActivityBar";
import { navigationActivityFallback } from "../../src/app/navigationPreferences";
import { useNavigationIcons } from "../../src/app/useNavigationIcons";
import { useWorkspace } from "../../src/app/useWorkspace";
import { NavigationIconSettings } from "../../src/settings/NavigationIconSettings";
import "../../src/theme/global.css";

function Fixture() {
  const [icons, setIcons] = useNavigationIcons();
  const [activity, setActivity] = useState<ActivityId>("connections");
  const workspace = useWorkspace();
  const api = useRef({ createCalls: 0, release: () => {} }).current;
  const deferred = useRef(new URLSearchParams(location.search).has("deferred"));
  Object.assign(window, { editorNavigationFixture: api });
  async function create() {
    const number = ++api.createCalls;
    if (deferred.current) await new Promise<void>((resolve) => { api.release = () => { deferred.current = false; resolve(); }; });
    const id = workspace.addEditorTab({ id: `fixture-${number}`, source: { kind: "local" }, rootPath: null, initialFile: null }, `编辑器 ${number}`);
    setActivity("sessions"); return id;
  }
  async function openEntry() { if (await workspace.openEditorEntry(create)) setActivity("sessions"); }
  useEffect(() => { const fallback = navigationActivityFallback(activity, icons); if (fallback) setActivity(fallback); }, [activity, icons]);
  return <main style={{ display: "flex", height: "100vh" }}>
    <ActivityBar activeActivity={activity} visibleNavigationIcons={icons} onSelectActivity={setActivity} sidebarCollapsed={false} rightPanel={null}
      onToggleRightPanel={() => {}} onNewLocalTerminal={() => {}} onOpenBrowser={() => {}} onOpenSettings={() => {}}
      onOpenEditor={() => { void openEntry(); }} />
    <section style={{ width: 420, padding: 16 }}><h2>左侧导航栏</h2><NavigationIconSettings value={icons} onChange={setIcons} />
      <output aria-label="已打开的编辑器">{workspace.editorTabs.length}</output>
      <button onClick={() => { void create(); }}>新建文本编辑器</button>
      <button onClick={() => { workspace.focusTerminal(); setActivity("sessions"); }}>切换到终端</button>
      <div role="tablist" aria-label="测试工作台标签">{workspace.editorTabs.map(tab => <div key={tab.id}>
        <button role="tab" aria-selected={workspace.activeEditorId === tab.id} onClick={() => { workspace.focusEditorTab(tab.id); setActivity("sessions"); }}>{tab.title}</button>
        <button aria-label={`关闭 ${tab.title}`} onClick={() => workspace.closeEditorTab(tab.id)}>关闭</button>
      </div>)}</div>
      <div role="region" aria-label="编辑工作台" hidden={activity !== "sessions" || !workspace.activeEditorId}>
        {workspace.editorTabs.map(tab => <div key={tab.id} hidden={workspace.activeEditorId !== tab.id}><textarea aria-label={`草稿 ${tab.title}`} /></div>)}
      </div>
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
