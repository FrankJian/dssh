import figlet from "figlet/browser";
import standard from "figlet/fonts/Standard";
import small from "figlet/fonts/Small";

figlet.parseFont("Standard", standard);
figlet.parseFont("Small", small);

export function asciiArt(input: string, font: "Standard" | "Small"): string {
  const text = input.trim();
  if (!text || text.length > 160 || /[^\x20-\x7e\r\n]/.test(text)) {
    throw new Error("请输入不超过 160 个字符的 ASCII 文本。");
  }
  return figlet.textSync(text, { font, trimWhitespace: "none" });
}
