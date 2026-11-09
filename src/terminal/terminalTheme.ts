import type { ITheme } from "@xterm/xterm";
import { BUILTIN_TERMINAL_SCHEMES } from "./themes/presets";

/** Compatibility export for the default Graphite Dark palette. */
export const terminalTheme: ITheme = {
  ...BUILTIN_TERMINAL_SCHEMES[0].colors,
  selectionForeground: undefined,
};
