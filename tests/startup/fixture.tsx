import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockWindows, mockIPC } from "@tauri-apps/api/mocks";
import { LazyTerminalView } from "../../src/terminal/LazyTerminalView";
import { hasTerminalInstance, restoreTerminalSnapshot, serializeTerminal } from "../../src/terminal/terminalRegistry";
import { lazyFeature } from "../../src/ui/lazyFeature";
import { Button } from "../../src/ui/Button";
import "../../src/theme/global.css";
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
mockWindows("main");
mockIPC(command => { throw new Error(`No native calls permitted in startup fixture: ${command}`); });
restoreTerminalSnapshot("startup-fixture", { data: "restored-before-load\r\n", cols: 80, rows: 24 });
let attempts = 0;
const Recovery = lazyFeature("测试功能", async () => {
  if (++attempts === 1) throw new TypeError("Synthetic module failure");
  return { default: () => <p>功能重试成功</p> };
});
function Fixture() {
  const [opened, setOpened] = useState(false), [failure, setFailure] = useState(false);
  const [ready, setReady] = useState(false), [restored, setRestored] = useState(false), [input, setInput] = useState("");
  const [engineResources, setEngineResources] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setReady(hasTerminalInstance("startup-fixture"));
      setRestored(serializeTerminal("startup-fixture")?.data.includes("restored-before-load") ?? false);
      setEngineResources(performance.getEntriesByType("resource").filter(entry => /terminalAddons|@xterm|xterm_/.test(entry.name)).length);
    }, 200);
    return () => clearInterval(timer);
  }, []);
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column", padding: 20, gap: 12 }}>
    <nav style={{ display: "flex", gap: 12 }}><Button onClick={() => setOpened(true)}>首次打开模拟终端</Button><Button onClick={() => setFailure(true)}>测试功能导入失败</Button></nav>
    <output aria-label="引擎加载状态">引擎资源 {engineResources}；实例 {String(ready)}；快照恢复 {String(restored)}</output>
    <output aria-label="终端输入">输入：{input}</output>
    {failure ? <Recovery /> : null}
    {opened ? <section style={{ flex: 1, minHeight: 0 }}><LazyTerminalView sessionId="startup-fixture" isLocalShell autoFocus onData={data => setInput(value => value + data)} onResize={() => {}} getBacklog={() => ""} subscribeOutput={() => () => {}} /></section> : <p>首屏未请求终端引擎。</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
