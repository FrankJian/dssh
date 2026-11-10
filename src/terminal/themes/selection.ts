import type { TerminalColors, TerminalThemeKind } from "./types";

type SelectionColors = Pick<TerminalColors,
  "selectionBackground" | "selectionInactiveBackground" | "selectionForeground">;

/** Explicit text/background pairs keep ANSI and true-color text legible while selected. */
export const TERMINAL_SELECTION_COLORS: Record<TerminalThemeKind, SelectionColors> = {
  dark: {
    selectionBackground: "#365f87",
    selectionInactiveBackground: "#3a4d63",
    selectionForeground: "#f5f8fc",
  },
  light: {
    selectionBackground: "#8eb4df",
    selectionInactiveBackground: "#c2d0e1",
    selectionForeground: "#182c43",
  },
};
