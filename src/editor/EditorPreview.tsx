import { isValidElement, useDeferredValue, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../ui/Button";
import { limitMermaidDiagrams } from "./markdownDiagrams";
import { MermaidDiagram } from "../sftp/MermaidDiagram";
import { EditorFileProvider } from "./fileProvider";

export function EditorMarkdownPreview({ content, enabled = true }: { content: string; enabled?: boolean }) {
  const deferred = useDeferredValue(content);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return <article className="editor-markdown ai-markdown" aria-label="Markdown 预览"><p role="status">预览已暂停</p></article>;
  if (deferred.length > 1024 * 1024) return <p role="status">Markdown 超过 1 MiB，预览已暂停。</p>;
  return <article className="editor-markdown ai-markdown" aria-label="Markdown 预览">
    {error ? <p role="alert">{error}</p> : null}
    <ReactMarkdown remarkPlugins={[remarkGfm, limitMermaidDiagrams]} skipHtml components={{
      pre: ({ children }) => {
        const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
        if (code?.props.className === "language-dssh-mermaid-limit") return <p role="status">单个文档仅渲染前 32 幅 Mermaid 图，其余保留为代码。</p>;
        if (code && /(?:^|\s)language-(?:mermaid|mamerid)(?:\s|$)/i.test(code.props.className ?? "")) return <MermaidDiagram chart={String(code.props.children ?? "").replace(/\n$/, "")} enabled={enabled} />;
        return <pre>{children}</pre>;
      },
      // Untrusted documents never fetch remote images or navigate the webview.
      img: ({ alt }) => <span title="文档图片不会自动加载">[图片：{alt || "未命名"}]</span>,
      a: ({ children, href }) => /^https?:\/\//i.test(href ?? "") ? <a href={href} rel="noreferrer" onClick={(event) => {
        event.preventDefault(); void openUrl(href!).catch(() => setError("无法打开链接。"));
      }}>{children}</a> : <span>{children}</span>,
    }}>{deferred}</ReactMarkdown>
  </article>;
}
export function EditorImagePreview({ path, provider, enabled }: { path: string; provider: EditorFileProvider; enabled: boolean }) {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true; setState({});
    if (enabled) void provider.image(path).then((image) => {
      if (alive) setState(/^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml);base64,[a-z\d+/=]+$/i.test(image.dataUrl) ? { url: image.dataUrl } : { error: "图片格式不受支持。" });
    }).catch((error) => { if (alive) setState({ error: error instanceof Error ? error.message : "读取图片失败。" }); });
    return () => { alive = false; };
  }, [path, provider, enabled, attempt]);
  return <div className="editor-image-preview" aria-label="图片预览">{!enabled ? <span role="status">图片预览已暂停</span> : state.error ? <div role="alert">{state.error}<Button onClick={() => setAttempt((n) => n + 1)}>重试</Button></div> : state.url ? <img src={state.url} alt={path} onError={() => setState({ error: "无法解码这张图片，请检查文件内容或格式。" })} /> : <span role="status">正在读取图片…</span>}</div>;
}
