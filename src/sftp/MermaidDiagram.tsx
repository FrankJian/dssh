import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { renderMermaid } from "../editor/mermaidRender";
import { mermaidPng } from "../editor/mermaidImage";
import "./MermaidDiagram.css";
import { saveToolImage } from "../services/toolsService";

type Theme = "dark" | "default";
type DiagramState = { kind: "loading" } | { kind: "ready"; svg: string; chart: string; theme: Theme } | { kind: "error"; message: string; chart: string; theme: Theme };
const resolveTheme = (): Theme => document.documentElement.dataset.theme === "dark" ? "dark" : "default";
export function MermaidDiagram({ chart, enabled = true }: { chart: string; enabled?: boolean }) {
  const rawId = useId(); const sequence = useRef(0);
  const [theme, setTheme] = useState(resolveTheme);
  const [state, setState] = useState<DiagramState>({ kind: "loading" });
  const [exporting, setExporting] = useState(false); const [feedback, setFeedback] = useState<string | null>(null);
  const [exportError, setExportError] = useState(false);
  const current = useRef({ chart, theme, enabled, generation: 0 });
  if (current.current.chart !== chart || current.current.theme !== theme || current.current.enabled !== enabled) current.current = { chart, theme, enabled, generation: current.current.generation + 1 };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { const observer = new MutationObserver(() => setTheme(resolveTheme())); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); return () => observer.disconnect(); }, []);
  useEffect(() => {
    let cancelled = false; setState({ kind: "loading" }); setFeedback(null);
    if (!enabled) return;
    const id = `dssh-mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}-${++sequence.current}`;
    void Promise.resolve().then(() => renderMermaid(chart, id, theme, () => !cancelled)).then((svg) => { if (!cancelled && svg) setState({ kind: "ready", svg, chart, theme }); })
      .catch((error: unknown) => { if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : "无法预览此图表，请检查语法。", chart, theme }); });
    return () => { cancelled = true; };
  }, [chart, theme, rawId, enabled]);
  const ready = enabled && state.kind === "ready" && state.chart === chart && state.theme === theme ? state : null;
  async function exportPng() {
    if (!ready || exporting || !current.current.enabled) return;
    const generation = current.current.generation;
    const unchanged = () => mounted.current && current.current.enabled && current.current.generation === generation;
    setExporting(true); setFeedback(null); setExportError(false);
    try {
      const background = getComputedStyle(document.documentElement).getPropertyValue("--bg-app").trim();
      const png = await mermaidPng(ready.svg, background);
      if (!unchanged()) return;
      const saved = await saveToolImage(png);
      if (unchanged()) setFeedback(saved ? "PNG 已保存" : "已取消保存");
    } catch (error) { if (unchanged()) { setExportError(true); setFeedback(error instanceof Error ? error.message : "导出失败，请重试。"); } }
    finally { if (mounted.current) setExporting(false); }
  }
  return <figure className="mermaid-diagram editor-mermaid" aria-label="Mermaid 图表">
    <figcaption><span>Mermaid</span><IconButton label="导出 PNG" disabled={!ready || exporting} onClick={() => void exportPng()}><Icon name={exporting ? "refresh" : "download"} /></IconButton></figcaption>
    {ready ? <img className="mermaid-diagram-image" alt="Mermaid 图表预览" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(ready.svg)}`} />
      : state.kind === "error" && state.chart === chart && state.theme === theme ? <p role="alert">{state.message}</p> : <p role="status">{enabled ? "正在渲染 Mermaid 图表…" : "图表预览已暂停"}</p>}
    {feedback ? <p role={exportError ? "alert" : "status"}>{feedback}</p> : null}
  </figure>;
}
