export interface QuickOpenItem { path: string; relativePath: string }
export function fuzzyPathScore(path: string, query: string): number | null {
  const needle = query.trim().toLocaleLowerCase(); if (!needle) return 0;
  const haystack = path.toLocaleLowerCase(); let cursor = 0; let score = 0; let previous = -2;
  for (const character of needle) {
    const position = haystack.indexOf(character, cursor); if (position < 0) return null;
    score += position === previous + 1 ? 8 : 1;
    if (position === 0 || "/\\-_. ".includes(haystack[position - 1])) score += 6;
    cursor = position + character.length; previous = position;
  }
  const basename = haystack.slice(haystack.lastIndexOf("/") + 1); if (basename.startsWith(needle)) score += 40;
  return score - path.length / 1000;
}
export function quickOpenMatches(items: QuickOpenItem[], query: string): QuickOpenItem[] {
  if (items.length > 100_000 || query.length > 256) throw new Error("快捷打开超过查询预算。");
  if (!query.trim()) return items.slice(0, 100);
  return items.map((item) => ({ item, score: fuzzyPathScore(item.relativePath, query) })).filter((item): item is { item: QuickOpenItem; score: number } => item.score !== null).sort((a, b) => b.score - a.score || a.item.relativePath.localeCompare(b.item.relativePath)).slice(0, 100).map((item) => item.item);
}
