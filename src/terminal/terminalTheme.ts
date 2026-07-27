import type { ITheme } from "@xterm/xterm";

/**
 * dssh "Nebula" terminal palette — a cool violet-tinted scheme that matches the
 * app's Violet design tokens. The signature is the violet cursor (#8b7cf6) and a
 * near-black graphite background (#14141c) shared with --terminal-bg.
 */
export const terminalTheme: ITheme = {
  background: "#14141c",
  foreground: "#e6e6f0",
  cursor: "#8b7cf6",
  cursorAccent: "#14141c",
  // Selection colors are deliberately close in luminance to the background.
  //
  // xterm's WebGL renderer bakes the cell background into the glyph texture:
  // unselected glyphs are rasterized on a transparent backdrop and composited by
  // the shader, while a selected cell gets a *new* atlas entry antialiased
  // against the selection color. The two paths antialias differently, which
  // reads as a change in font weight. Keeping the selection close to the
  // terminal background makes both rasterizations nearly identical, so the shift
  // is not noticeable. (Turning off GPU acceleration switches to the DOM
  // renderer, which leaves the text nodes untouched and is pixel-identical.)
  selectionBackground: "#2b2550",
  selectionInactiveBackground: "#201c38",
  black: "#2a2a38",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#7c9cf0",
  magenta: "#c084fc",
  cyan: "#4dd4c4",
  white: "#e6e6f0",
  brightBlack: "#4a4a5c",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#a5b8f5",
  brightMagenta: "#d8b4fe",
  brightCyan: "#7ee7db",
  brightWhite: "#ffffff",
};
