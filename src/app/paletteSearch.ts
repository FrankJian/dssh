interface SearchableItem { label: string; hint?: string; keywords?: string; searchPriority?: number }

function normalize(value: string): string { return value.toLowerCase().replace(/\\/g, "/"); }

function tokenScore(token: string, field: string): number | null {
  const text = normalize(field);
  const exact = text.indexOf(token);
  if (exact >= 0) return 100 + token.length * 2 - Math.min(exact, 40);
  let index = 0;
  let previous = -2;
  let score = 0;
  for (let i = 0; i < text.length && index < token.length; i += 1) {
    if (text[i] === token[index]) {
      score += previous === i - 1 ? 2 : 1;
      previous = i;
      index += 1;
    }
  }
  return index === token.length ? score : null;
}

/** Every token must match, independently of input order; labels rank ahead of metadata. */
export function filterPaletteItems<T extends SearchableItem>(items: readonly T[], query: string): T[] {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...items];
  return items.map((item, index) => {
    let score = 0;
    for (const token of tokens) {
      const fields = [item.label, item.hint ?? "", item.keywords ?? ""];
      const matches = fields.map((field, fieldIndex) => {
        const match = tokenScore(token, field);
        return match === null ? null : match + (2 - fieldIndex) * 5;
      }).filter((match): match is number => match !== null);
      if (matches.length === 0) return null;
      score += Math.max(...matches);
    }
    return { item, score, index };
  }).filter((entry): entry is { item: T; score: number; index: number } => entry !== null)
    .sort((a, b) => (b.item.searchPriority ?? 0) - (a.item.searchPriority ?? 0) || b.score - a.score || a.index - b.index).map((entry) => entry.item);
}
