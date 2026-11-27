import { useState } from "react";
import { createRoot } from "react-dom/client";
import { lazyTool } from "../../src/tools/lazyTool";
import { ErrorBoundary } from "../../src/ui/ErrorBoundary";
import { mockWindows } from "@tauri-apps/api/mocks";
import { Button } from "../../src/ui/Button";
import "../../src/theme/global.css";
import "../../src/tools/tools.css";
mockWindows("main");
const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme = query.get("theme") === "light" ? "light" : "dark";
let attempts = 0;
const Recoverable = lazyTool(async () => {
  if (++attempts === 1) throw new TypeError("Importing a module script failed.");
  return import("../../src/tools/JsonFormatTool");
});
function Fixture() {
  const [page, setPage] = useState("failure");
  const [note, setNote] = useState("");
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
    <nav aria-label="测试导航" style={{ display: "flex", gap: 12 }}><Button onClick={() => setPage("failure")}>故障工具</Button><Button onClick={() => setPage("other")}>其他工具</Button><Button onClick={() => setPage("home")}>主页面</Button></nav>
    <label>保留的草稿 <input aria-label="保留的草稿" value={note} onChange={e => setNote(e.target.value)} /></label>
    <section hidden={page !== "failure"} style={{ flex: 1, minHeight: 0 }}><Recoverable /></section>
    <section hidden={page !== "other"}>其他工具仍可使用</section>
    <section hidden={page !== "home"}>主导航仍可使用</section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ErrorBoundary><Fixture /></ErrorBoundary>);
