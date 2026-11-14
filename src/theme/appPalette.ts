export type AppAppearance = "dark" | "light";

export const appPaletteStorageKey = "dssh.app.paletteColor";
export const DEFAULT_APP_PALETTE_COLOR = "#84c6ae";

export function normalizeAppPaletteColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (/^#[\da-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split("").map((part) => part + part).join("").toLowerCase()}`;
  }
  return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

function colorComponents(color: string) {
  const [red, green, blue] = color.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16) / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const range = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  const saturation = range === 0 ? 0 : range / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (range > 0) {
    if (maximum === red) hue = ((green - blue) / range) % 6;
    else if (maximum === green) hue = (blue - red) / range + 2;
    else hue = (red - green) / range + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return {
    hue: Math.round(hue),
    saturation: saturation < 0.08 ? 0 : Math.round(Math.min(42, Math.max(24, saturation * 100))),
    lightness: Math.round(lightness * 100),
  };
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness / 100 - 1)) * saturation / 100;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  const offset = lightness / 100 - chroma / 2;
  return `#${[red, green, blue].map((value) => Math.round((value + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function appPaletteContrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function appPaletteTokens(color: string, appearance: AppAppearance): Record<string, string> {
  const { hue, saturation, lightness } = colorComponents(color);
  const subtle = Math.min(saturation, 16);
  const hsl = (lightness: number, sat = saturation, alpha?: number) =>
    `hsl(${hue} ${sat}% ${lightness}%${alpha === undefined ? "" : ` / ${alpha}%`})`;
  const hex = (lightness: number, sat = saturation) => hslToHex(hue, sat, lightness);
  let readableLightness = 50;
  while (readableLightness > 0 && appPaletteContrast("#ffffff", hex(readableLightness)) < 4.6) readableLightness--;
  // The chosen color's lightness controls the palette's depth. Keep the
  // appearance modes distinct and cap action colors at readable levels.
  const darkBase = Math.max(7, Math.min(17, Math.round(10 + (lightness - 50) * 0.12)));
  const lightBase = Math.max(92, Math.min(98, Math.round(95 + (lightness - 50) * 0.08)));
  const darkAccent = Math.max(65, Math.min(83, Math.round(72 + (lightness - 50) * 0.34)));
  const lightAccent = Math.max(18, Math.min(readableLightness - 1, Math.round(22 + lightness * 0.25)));
  const primaryLightness = Math.max(16, Math.min(readableLightness - 5, Math.round(18 + lightness * 0.22)));
  const primary = hex(primaryLightness);
  const primaryHover = hex(Math.min(readableLightness - 1, primaryLightness + 4));

  if (appearance === "dark") {
    return {
      "--bg-app": hex(darkBase, subtle),
      "--bg-activity": hsl(darkBase + 1, subtle, 94),
      "--bg-titlebar": hsl(darkBase + 3, subtle, 92),
      "--bg-toolbar": hsl(darkBase + 5, subtle, 92),
      "--bg-panel": hsl(darkBase + 6, subtle, 96),
      "--bg-panel-muted": hsl(darkBase + 10, subtle, 94),
      "--bg-sunken": hex(Math.max(4, darkBase - 2), subtle),
      "--bg-elevated": hsl(darkBase + 12, subtle, 97),
      "--bg-sidebar": hsl(darkBase + 6, subtle, 96),
      "--bg-hover": hsl(78, saturation, 7),
      "--bg-selected": hsl(darkAccent, saturation, 17),
      "--bg-empty-area": hex(darkBase, subtle),
      "--bg-empty-panel": hsl(darkBase + 6, subtle, 96),
      "--bg-modal-header": hsl(darkBase + 8, subtle, 97),
      "--bg-modal-footer": hsl(darkBase + 8, subtle, 97),
      "--border-subtle": hsl(88, subtle, 11),
      "--border-strong": hsl(88, subtle, 22),
      "--divider": hsl(88, subtle, 8),
      "--text-strong": hex(95, 7),
      "--text-base": hex(87, 7),
      "--text-muted": hex(72, 7),
      "--text-faint": hex(60, 7),
      "--accent": hex(darkAccent),
      "--accent-strong": hex(Math.min(88, darkAccent + 9)),
      "--accent-soft": hsl(darkAccent, saturation, 15),
      "--accent-border": hsl(Math.min(90, darkAccent + 4), saturation, 52),
      "--accent-fg": hex(15, subtle),
      "--selection": hsl(darkAccent, saturation, 17),
      "--btn-primary-bg": primary,
      "--btn-primary-bg-hover": primaryHover,
      "--btn-primary-fg": "#ffffff",
      "--glass-fallback-bg": hex(darkBase + 8, subtle),
    };
  }

  return {
    "--bg-app": hex(lightBase, subtle),
    "--bg-activity": hsl(lightBase - 5, subtle, 96),
    "--bg-titlebar": hsl(lightBase - 2, subtle, 94),
    "--bg-toolbar": hsl(lightBase - 3, subtle, 95),
    "--bg-panel": hsl(Math.min(99, lightBase + 3), subtle, 97),
    "--bg-panel-muted": hsl(lightBase - 2, subtle, 96),
    "--bg-sunken": hex(lightBase - 5, subtle),
    "--bg-elevated": hsl(99, subtle, 98),
    "--bg-sidebar": hsl(Math.min(99, lightBase + 3), subtle, 97),
    "--bg-hover": hsl(32, saturation, 6),
    "--bg-selected": hsl(lightAccent, saturation, 12),
    "--bg-empty-area": hex(lightBase, subtle),
    "--bg-empty-panel": hsl(Math.min(99, lightBase + 3), subtle, 97),
    "--bg-modal-header": hsl(Math.min(99, lightBase + 1), subtle, 98),
    "--bg-modal-footer": hsl(Math.min(99, lightBase + 1), subtle, 98),
    "--border-subtle": hsl(25, subtle, 11),
    "--border-strong": hsl(25, subtle, 22),
    "--divider": hsl(25, subtle, 8),
    "--text-strong": hex(16, 7),
    "--text-base": hex(24, 7),
    "--text-muted": hex(38, 7),
    "--text-faint": hex(40, 7),
    "--accent": hex(lightAccent),
    "--accent-strong": hex(Math.max(10, lightAccent - 7)),
    "--accent-soft": hsl(lightAccent, saturation, 11),
    "--accent-border": hsl(lightAccent, saturation, 42),
    "--accent-fg": "#ffffff",
    "--selection": hsl(lightAccent, saturation, 12),
    "--btn-primary-bg": primary,
    "--btn-primary-bg-hover": primaryHover,
    "--btn-primary-fg": "#ffffff",
    "--glass-fallback-bg": hex(99, subtle),
  };
}
