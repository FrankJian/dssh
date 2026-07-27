import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  content: string;
}

/**
 * Renders assistant output as GitHub-flavored Markdown (headings, lists,
 * tables, fenced code). Raw HTML is intentionally not rendered to avoid XSS
 * from model output; the styling lives in `.ai-markdown` in global.css.
 */
function MarkdownImpl({ content }: MarkdownProps) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
