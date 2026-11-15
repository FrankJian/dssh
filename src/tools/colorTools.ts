type Rgba = [number, number, number, number];

function component(token: string, max: number, allowPercentage = true): number {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(token)) throw new Error("颜色分量必须是数字。");
  const percent = token.endsWith("%");
  if (percent && !allowPercentage) throw new Error("色相请使用角度数值。");
  const number = Number(percent ? token.slice(0, -1) : token);
  if (!Number.isFinite(number) || (max !== 360 && (number < 0 || number > (percent ? 100 : max)))) {
    throw new Error("颜色分量超出范围。");
  }
  return percent ? number * max / 100 : number;
}

function parseColor(input: string): Rgba {
  const text = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const raw = hex[1].length <= 4 ? Array.from(hex[1], (character) => character.repeat(2)).join("") : hex[1];
    const byte = (offset: number) => parseInt(raw.slice(offset, offset + 2), 16);
    return [byte(0), byte(2), byte(4), raw.length === 8 ? byte(6) / 255 : 1];
  }
  const functional = /^(rgb|rgba|hsl|hsla)\(\s*([^()]+)\s*\)$/.exec(text);
  if (!functional) throw new Error("请输入 HEX、RGB(A) 或 HSL(A) 颜色。");

  const value = functional[2].trim();
  let channels: string[];
  let opacity: string | undefined;
  if (value.includes(",")) {
    const parts = value.split(",").map((part) => part.trim());
    channels = parts.slice(0, 3);
    opacity = parts[3];
    if (parts.length > 4) throw new Error("颜色分量过多。");
  } else {
    const parts = value.split("/").map((part) => part.trim());
    if (parts.length > 2) throw new Error("透明度分量无效。");
    channels = parts[0].split(/\s+/);
    opacity = parts[1];
  }
  if (channels.length !== 3) throw new Error("颜色需要三个分量。");
  const alpha = opacity === undefined ? 1 : component(opacity, 1);
  if (functional[1].startsWith("rgb")) {
    const [r, g, b] = channels.map((part) => component(part, 255));
    return [r, g, b, alpha];
  }
  if (!channels[1].endsWith("%") || !channels[2].endsWith("%")) throw new Error("HSL 饱和度和亮度必须使用百分比。");
  const hue = component(channels[0].replace(/deg$/, ""), 360, false);
  const h = ((hue % 360) + 360) % 360;
  const s = component(channels[1], 1);
  const l = component(channels[2], 1);
  const amplitude = s * Math.min(l, 1 - l);
  const channel = (position: number) => {
    const k = (position + h / 30) % 12;
    return 255 * (l - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4), alpha];
}

const digits = (value: number) => Number(value.toFixed(6));

export function convertColor(input: string): string {
  const [red, green, blue, alpha] = parseColor(input);
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const delta = max - min;
  const light = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
  let hue = 0;
  if (delta) {
    const position = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = ((position * 60) + 360) % 360;
  }
  const byte = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");
  return [
    "#" + byte(red) + byte(green) + byte(blue) + (alpha === 1 ? "" : byte(alpha * 255)),
    `rgb(${digits(red)} ${digits(green)} ${digits(blue)}${alpha === 1 ? "" : ` / ${digits(alpha)}`})`,
    `hsl(${digits(hue)} ${digits(saturation * 100)}% ${digits(light * 100)}%${alpha === 1 ? "" : ` / ${digits(alpha)}`})`,
  ].join("\n");
}

export function svgPlaceholder(input: string, label: string): string {
  const size = /^(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec(input.trim());
  if (!size || size.slice(1).some((value) => Number(value) < 1 || Number(value) > 4096)) {
    throw new Error("请输入 1–4096 像素的宽度与高度，例如 640x360。");
  }
  const [, w, h] = size;
  const width = Number(w);
  const height = Number(h);
  const caption = (label.trim() || `${width} × ${height}`).slice(0, 120)
    .replace(/[<>&]/g, (character) => character === "<" ? "&lt;" : character === ">" ? "&gt;" : "&amp;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
    + '  <rect width="100%" height="100%" fill="#e8eeeb"/>\n'
    + `  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#34463f" font-family="sans-serif" font-size="${Math.max(1, Math.min(36, Math.round(Math.min(width, height) / 8)))}">${caption}</text>\n</svg>`;
}
