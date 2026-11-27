export interface TextSearchQuery { pattern: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean; replacement?: string }
export interface TextSearchMatch { start: number; end: number; line: number; column: number; endLine: number; endColumn: number; preview: string; replacement: string }
export interface TextSearchResult { matches: TextSearchMatch[]; truncated: boolean; content?: string }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function compileTextSearch(query: TextSearchQuery): RegExp {
  if (!query.pattern || query.pattern.length > 2048) throw new Error("搜索文本需为 1–2048 个字符。");
  return new RegExp(query.regex ? query.pattern : escapeRegex(query.pattern), `gmu${query.caseSensitive ? "" : "i"}`);
}
const word = /[\p{L}\p{N}_]/u;
function previousCharacter(text: string, offset: number) { const part = text.slice(Math.max(0, offset - 2), offset); return Array.from(part).pop() ?? ""; }
function nextCharacter(text: string, offset: number) { return String.fromCodePoint(text.codePointAt(offset) ?? 32); }
/** JavaScript replacement semantics without executing replacement as code. */
function replacementFor(template: string, match: RegExpExecArray, text: string): string {
  let size = template.length;
  const tokenValue = (token: string, key: string) => {
    if (key === "$") return "$"; if (key === "&") return match[0]; if (key === "`") return text.slice(0, match.index); if (key === "'") return text.slice(match.index + match[0].length);
    if (key.startsWith("<")) return match.groups ? match.groups[key.slice(1, -1)] ?? "" : token;
    const index = Number(key);
    if (index > 0 && index < match.length) return match[index] ?? "";
    if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) < match.length) return `${match[Number(key[0])] ?? ""}${key[1]}`;
    return token;
  };
  return template.replace(/\$([$&`']|\d{1,2}|<[^>]+>)/g, (token, key: string) => {
    const value = tokenValue(token, key); size += value.length - token.length;
    if (size > 20 * 1024 * 1024) throw new Error("替换结果超过单文件预算。");
    return value;
  });
}
export function searchText(text: string, query: TextSearchQuery, limit = 2000): TextSearchResult {
  if (text.length > 20 * 1024 * 1024) throw new Error("文件超过内容搜索预算。");
  const regex = compileTextSearch(query); const matches: TextSearchMatch[] = []; let truncated = false;
  if ((query.replacement?.length ?? 0) > 2048) throw new Error("替换文本最多支持 2048 个字符。");
  let replacementBytes = 0;
  let line = 1; let lineStart = 0; let nextLine = text.indexOf("\n");
  for (;;) {
    const match = regex.exec(text); if (!match) break;
    const start = match.index; const end = start + match[0].length;
    if (!match[0].length) { const point = text.codePointAt(regex.lastIndex); regex.lastIndex += point !== undefined && point > 0xffff ? 2 : 1; }
    if (query.wholeWord && (word.test(previousCharacter(text, start)) || word.test(nextCharacter(text, end)))) continue;
    if (matches.length >= Math.min(2000, Math.max(0, limit))) { truncated = true; break; }
    while (nextLine >= 0 && nextLine < start) { line++; lineStart = nextLine + 1; nextLine = text.indexOf("\n", lineStart); }
    let endLine = line; let endLineStart = lineStart; let boundary = nextLine;
    while (boundary >= 0 && boundary < end) { endLine++; endLineStart = boundary + 1; boundary = text.indexOf("\n", endLineStart); }
    const previewStart = Math.max(lineStart, start - 100);
    const previewEnd = Math.min(nextLine < 0 ? text.length : nextLine, previewStart + 300);
    const replacement = query.regex ? replacementFor(query.replacement ?? "", match, text) : query.replacement ?? "";
    replacementBytes += replacement.length;
    if (replacementBytes > 20 * 1024 * 1024) throw new Error("替换结果超过单文件预算。");
    matches.push({ start, end, line, column: start - lineStart + 1, endLine, endColumn: end - endLineStart + 1,
      preview: text.slice(previewStart, previewEnd).replace(/\r$/, ""), replacement });
  }
  // Only complete, version-bound plans may be applied. Truncated plans have no replacement body.
  if (query.replacement === undefined || truncated) return { matches, truncated };
  let content = ""; let cursor = 0;
  for (const match of matches) { content += text.slice(cursor, match.start) + match.replacement; cursor = match.end; if (content.length > 20 * 1024 * 1024) throw new Error("替换结果超过单文件预算。"); }
  content += text.slice(cursor); if (content.length > 20 * 1024 * 1024) throw new Error("替换结果超过单文件预算。");
  return { matches, truncated, content };
}
