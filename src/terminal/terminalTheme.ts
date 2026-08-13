import type { ITheme } from "@xterm/xterm";

/**
 * dssh "Graphite" terminal palette — a cold-black scheme with an ice-blue
 * cursor, aligned with the app's Graphite Glass tokens. ANSI colours remain
 * semantic terminal content rather than application-brand colours.
 */
export const terminalTheme: ITheme = {
  background: "#0b0e12",
  foreground: "#dde4ea",
  cursor: "#a8c7de",
  cursorAccent: "#0b0e12",
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
  selectionBackground: "#182630",
  selectionInactiveBackground: "#121c24",
  black: "#151b22",
  red: "#e18484",
  green: "#73c9a2",
  yellow: "#d6b56c",
  blue: "#79a6c9",
  magenta: "#c69ac9",
  cyan: "#70c5c8",
  white: "#dde4ea",
  brightBlack: "#65717c",
  brightRed: "#efaaaa",
  brightGreen: "#9ad8ba",
  brightYellow: "#e5ca8b",
  brightBlue: "#a8c7de",
  brightMagenta: "#dbb7dc",
  brightCyan: "#9bdcdf",
  brightWhite: "#ffffff",
};
