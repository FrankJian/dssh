import type { ITheme } from "@xterm/xterm";
import type { TerminalColors } from "./types";

export function toXtermTheme(colors: TerminalColors, transparent: boolean): ITheme {
  const { selectionForeground, ...theme } = colors;
  return {
    ...theme,
    ...(selectionForeground ? { selectionForeground } : {}),
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
