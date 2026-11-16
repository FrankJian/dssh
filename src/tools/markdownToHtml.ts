import { micromark } from "micromark";

export function markdownToHtml(input: string): string {
  if (input.length > 64 * 1024) throw new Error("Markdown 最多支持 65,536 个字符。");
  return micromark(input);
}
