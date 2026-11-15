const MATCH_LIMIT = 100;

export function findRegexMatches(pattern: string, flags: string, input: string): string {
  if (!pattern) throw new Error("请输入正则表达式。");
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    throw new Error("正则表达式或标志无效。");
  }

  function clip(value: string | undefined): string | null {
    if (value === undefined) return null;
    return value.length > 512 ? value.slice(0, 512) + "…" : value;
  }

  const matches = [];
  let match = regex.exec(input);
  while (match && matches.length < MATCH_LIMIT) {
    matches.push({
      index: match.index,
      match: clip(match[0]),
      ...(match.length > 1 ? { groups: match.slice(1, 31).map(clip), ...(match.length > 31 ? { moreGroups: match.length - 31 } : {}) } : {}),
    });

    if (!regex.global) {
      match = null;
      break;
    }
    if (match[0].length === 0) {
      const unicode = regex.unicode || flags.includes("v");
      const point = input.codePointAt(regex.lastIndex) ?? 0;
      regex.lastIndex += unicode && point > 0xffff ? 2 : 1;
    }
    match = regex.exec(input);
  }

  if (!matches.length) return "没有匹配项。";
  const count = match ? `仅显示前 ${MATCH_LIMIT} 项匹配` : `共 ${matches.length} 项匹配`;
  return `${count}\n\n${JSON.stringify(matches, null, 2)}`;
}
