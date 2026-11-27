import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";

import { RICH_MARKDOWN_LIMIT } from "./richMarkdownLimit.ts";
const parser = unified().use(remarkParse).use(remarkGfm);
interface SyntaxNode { type: string; children?: SyntaxNode[]; position?: { start: { offset?: number }; end: { offset?: number } }; [key: string]: unknown }
const supported = new Set(["root", "paragraph", "heading", "text", "strong", "emphasis", "delete", "inlineCode", "break", "blockquote", "list", "listItem", "code", "table", "tableRow", "tableCell", "link", "image", "thematicBreak"]);
function syntax(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(syntax);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["position", "spread"].includes(key)).map(([key, item]) => [key, syntax(item)]));
  return value;
}
function safe(node: SyntaxNode): boolean { return supported.has(node.type) && !node.children?.some((child) => !safe(child)); }
function fingerprint(node: JSONContent): string {
  return JSON.stringify(node, (key, value) => key === "sourceKey" ? undefined : value);
}
interface Original { raw: string; gap: string; fingerprint: string; index: number }

/** Lossless unedited blocks; unsupported syntax stays in safe, literal source blocks. */
export class RichMarkdownAdapter {
  private originals = new Map<string, Original>();
  private suffix = "";
  private sequence = 0;
  parse(source: string, markdown: MarkdownManager, normalize: (node: JSONContent) => JSONContent): JSONContent {
    if (source.length > RICH_MARKDOWN_LIMIT) throw new Error("Markdown 超过 1 MiB，请使用源码编辑。");
    this.originals.clear(); this.sequence++;
    const frontmatter = /^(?:---\r?\n[\s\S]*?\r?\n---|\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+)(?:\r?\n|$)/.exec(source)?.[0] ?? "";
    const body = source.slice(frontmatter.length);
    const tree = parser.parse(body) as unknown as SyntaxNode;
    let count = 0;
    const checkBudget = (node: SyntaxNode, depth = 0) => {
      if (++count > 20000 || depth > 100) throw new Error("Markdown 结构过于复杂，请使用源码编辑。");
      for (const child of node.children ?? []) checkBudget(child, depth + 1);
    };
    checkBudget(tree);
    const ranges = [ ...(frontmatter ? [{ raw: frontmatter.replace(/\r?\n$/, ""), start: 0, end: frontmatter.replace(/\r?\n$/, "").length, supported: false }] : []),
      ...(tree.children ?? []).map((node) => {
        const start = frontmatter.length + (node.position?.start.offset ?? 0), end = frontmatter.length + (node.position?.end.offset ?? 0);
        return { raw: source.slice(start, end), start, end, supported: safe(node) };
      }) ];
    if (ranges.length > 2000) throw new Error("Markdown 区块过多，请使用源码编辑。");
    let previousEnd = 0;
    const content = ranges.map((range, index) => {
      let node: JSONContent | undefined;
      if (range.supported && !/(?:\[\[|\{\{|^\s*(?:\$\$|:::|!!!))/m.test(range.raw)) {
        try {
          const parsed = markdown.parse(range.raw);
          if (parsed.content?.length === 1) {
            const candidate = normalize(parsed.content[0]);
            const roundtrip = markdown.serialize({ type: "doc", content: [candidate] });
            if (JSON.stringify(syntax(parser.parse(range.raw))) === JSON.stringify(syntax(parser.parse(roundtrip)))) node = candidate;
          }
        } catch { /* Preserve raw syntax rather than guessing at an unsupported conversion. */ }
      }
      node ??= { type: "rawMarkdown", attrs: { raw: range.raw } };
      const key = `${this.sequence}-${index}`;
      node = normalize({ ...node, attrs: { ...node.attrs, sourceKey: key } });
      this.originals.set(key, { raw: range.raw, gap: source.slice(previousEnd, range.start), fingerprint: fingerprint(node), index });
      previousEnd = range.end; return node;
    });
    this.suffix = source.slice(previousEnd);
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  }
  serialize(document: JSONContent, markdown: MarkdownManager): string {
    let lastIndex = -1;
    const blocks = (document.content ?? []).map((node, index) => {
      const original = this.originals.get(String(node.attrs?.sourceKey));
      const gap = original && original.index === lastIndex + 1 ? original.gap : index ? "\n\n" : "";
      const raw = original?.fingerprint === fingerprint(node) ? original.raw : node.type === "rawMarkdown" ? String(node.attrs?.raw ?? "") : markdown.serialize({ type: "doc", content: [node] });
      lastIndex = original?.index ?? -2;
      return gap + raw;
    }).join("");
    return blocks + (lastIndex === this.originals.size - 1 ? this.suffix : "\n");
  }
}

/** Keep source and rich edits on Monaco's existing undo stack without whole-document replacement. */
export function richMarkdownPaste(source: string, markdown: MarkdownManager, normalize: (node: JSONContent) => JSONContent): JSONContent[] {
  const parsed = new RichMarkdownAdapter().parse(source, markdown, normalize);
  // Clipboard blocks must not reuse identities owned by the current document.
  const clean = (node: JSONContent): JSONContent => {
    const attrs = { ...node.attrs }; delete attrs.sourceKey;
    return { ...node, attrs, ...(node.content ? { content: node.content.map(clean) } : {}) };
  };
  return (parsed.content ?? []).map(clean);
}

export function markdownChange(before: string, after: string) {
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (oldEnd < before.length && /[\uDC00-\uDFFF]/.test(before[oldEnd])) { oldEnd++; newEnd++; }
  return { start, oldEnd, text: after.slice(start, newEnd) };
}
