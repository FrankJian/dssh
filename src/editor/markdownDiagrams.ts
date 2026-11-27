interface MarkdownNode { type?: string; lang?: string; children?: MarkdownNode[] }
/** Bound rendering work across nested Markdown containers without changing source text. */
export function limitMermaidDiagrams() {
  return (tree: unknown) => {
    const pending = [tree as MarkdownNode]; let count = 0;
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === "code" && /^(mermaid|mamerid)$/i.test(node.lang ?? "") && ++count > 32) node.lang = count === 33 ? "dssh-mermaid-limit" : "text";
      for (let index = (node.children?.length ?? 0) - 1; index >= 0; index--) pending.push(node.children![index]);
    }
  };
}
