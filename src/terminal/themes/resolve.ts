import type { ITheme } from "@xterm/xterm";
import type { TerminalColors } from "./types";

// Remote LS_COLORS and TUI programs can combine any ANSI/256/RGB colors.
// Protect text against its actual cell background, including colored directories.
export const TERMINAL_MINIMUM_CONTRAST_RATIO = 4.5;

export function toXtermTheme(colors: TerminalColors, transparent: boolean): ITheme {
  const { selectionForeground, ...theme } = colors;
  return {
    ...theme,
    ...(selectionForeground ? { selectionForeground } : {}),
    // xterm converts fully opaque selection colors to a 30% overlay. Explicit
    // near-opaque alpha keeps the configured color visible on DOM and WebGL,
    // including transparent terminals, without changing persisted HEX colors.
    selectionBackground: `${colors.selectionBackground}fe`,
    selectionInactiveBackground: `${colors.selectionInactiveBackground}fe`,
    background: transparent ? "rgba(0, 0, 0, 0)" : colors.background,
  };
}

export function hexToRgbTriplet(hex: string): string {
  const normalized = hex.replace(/^#/, "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character + character).join("")
    : normalized;
  const value = Number.parseInt(expanded, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}
