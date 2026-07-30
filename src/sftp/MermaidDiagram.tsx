import { useEffect, useId, useState } from "react";

interface MermaidDiagramProps {
  chart: string;
}

type DiagramState =
  | { kind: "loading" }
  | { kind: "ready"; svg: string }
  | { kind: "error"; message: string };

function resolveTheme(): "dark" | "default" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

/**
 * Renders a Mermaid fenced code block from a remote Markdown file. Mermaid is
 * loaded only when a diagram is actually visible, and strict mode prevents a
 * remote document from injecting HTML or enabling interactive callbacks.
 */
export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const rawId = useId();
  const diagramId = `dssh-mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [theme, setTheme] = useState(resolveTheme);
  const [state, setState] = useState<DiagramState>({ kind: "loading" });

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(resolveTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
        });
        const { svg } = await mermaid.render(diagramId, chart);
        if (!cancelled) {
          setState({ kind: "ready", svg });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "未知渲染错误。",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, diagramId, theme]);

  if (state.kind === "loading") {
    return <div className="mermaid-diagram mermaid-diagram--loading">正在渲染 Mermaid 图表…</div>;
  }

  if (state.kind === "error") {
    return (
      <div className="mermaid-diagram mermaid-diagram--error" role="alert">
        <strong>Mermaid 图表无法渲染。</strong>
        <span>{state.message}</span>
      </div>
    );
  }

  // Mermaid's strict security mode sanitizes the generated SVG. Rendering it
  // as markup is required for SVG styles, markers and text to remain intact.
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
