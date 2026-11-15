export function textToUnicode(input: string): string {
  return [...input].map((character) => {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new Error("文本含有不完整的 Unicode 字符。");
    return "U+" + point.toString(16).toUpperCase().padStart(4, "0");
  }).join(" ");
}

export function unicodeToText(input: string): string {
  const text = input.trim();
  if (!text) return "";
  return text.split(/\s+/).map((token) => {
    if (!/^U\+[0-9a-f]{4,6}$/i.test(token)) throw new Error("请输入以空格分隔的 Unicode 码点，如 U+4E2D U+1F680。");
    const point = Number.parseInt(token.slice(2), 16);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      throw new Error("Unicode 码点超出有效范围。");
    }
    return String.fromCodePoint(point);
  }).join("");
}

export function textToBinary(input: string): string {
  return Array.from(new TextEncoder().encode(input), (byte) => byte.toString(2).padStart(8, "0")).join(" ");
}

export function binaryToText(input: string): string {
  const bits = input.replace(/\s/g, "");
  if (!/^[01]*$/.test(bits) || bits.length % 8 !== 0) throw new Error("请输入完整的 8 位二进制字节。");
  const bytes = new Uint8Array(bits.length / 8);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("二进制字节无法解码为有效的 UTF-8 文本。");
  }
}

type TextCase = "upper" | "lower" | "camel" | "pascal" | "snake" | "kebab";

export function changeTextCase(input: string, mode: TextCase): string {
  if (mode === "upper") return input.toUpperCase();
  if (mode === "lower") return input.toLowerCase();
  const words = input
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .match(/[\p{L}\p{N}\p{M}]+/gu)?.map((word) => word.toLowerCase()) ?? [];
  if (mode === "snake" || mode === "kebab") return words.join(mode === "snake" ? "_" : "-");
  return words.map((word, index) => {
    if (mode === "camel" && index === 0) return word;
    const initial = String.fromCodePoint(word.codePointAt(0)!);
    return initial.toUpperCase() + word.slice(initial.length);
  }).join("");
}

export function textStatistics(input: string): string {
  let words = 0;
  if (typeof Intl.Segmenter === "function") {
    for (const { isWordLike } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(input)) {
      if (isWordLike) words++;
    }
  } else {
    words = input.match(/[\p{L}\p{N}\p{M}]+/gu)?.length ?? 0;
  }
  return [
    `Unicode 码点　${[...input].length}`,
    `单词　${words}`,
    `行数　${input ? input.split(/\r\n|\r|\n/).length : 0}`,
    `UTF-8 字节　${new TextEncoder().encode(input).length}`,
  ].join("\n");
}

type ListSeparator = "line" | "comma" | "tab";
const LIST_SEPARATORS: Record<ListSeparator, string> = { line: "\n", comma: ",", tab: "\t" };

export function convertList(input: string, from: ListSeparator, to: ListSeparator, deduplicate: boolean): string {
  const separator = from === "line" ? /\r\n|\r|\n/ : LIST_SEPARATORS[from];
  const items = input.split(separator).map((item) => item.trim()).filter(Boolean);
  return (deduplicate ? [...new Set(items)] : items).join(LIST_SEPARATORS[to]);
}
