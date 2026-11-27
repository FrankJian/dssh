import { validateMermaidSource, MAX_MERMAID_TEXT } from "./mermaidImage";
let queue: Promise<unknown> = Promise.resolve();
/** Initialize and render together: Mermaid has process-wide mutable configuration. */
export function renderMermaid(chart: string, id: string, theme: "dark" | "default", alive: () => boolean): Promise<string | null> {
  validateMermaidSource(chart);
  const render = async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (!alive()) return null;
    const { default: mermaid } = await import("mermaid").catch(() => { throw new Error("图表组件加载失败，请重新打开预览后重试。"); });
    if (!alive()) return null;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, htmlLabels: false, maxTextSize: MAX_MERMAID_TEXT, maxEdges: 500, suppressErrorRendering: true,
      secure: ["securityLevel", "startOnLoad", "htmlLabels", "maxTextSize", "maxEdges", "theme", "themeCSS"] });
    const host = document.createElement("div"); host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none"; document.body.append(host);
    try { const result = await mermaid.render(id, chart, host); return alive() ? result.svg : null; }
    catch { throw new Error("Mermaid 图表无法渲染，请检查语法或拆分过于复杂的图表。"); }
    finally { host.remove(); }
  };
  const result = queue.then(render, render); queue = result.then(() => undefined, () => undefined); return result;
}
