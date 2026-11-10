import type { ITheme } from "@xterm/xterm";
import { BUILTIN_TERMINAL_SCHEMES } from "./themes/presets";
import { toXtermTheme } from "./themes/resolve";

/** Compatibility export for the default Graphite Dark palette. */
export const terminalTheme: ITheme = toXtermTheme(BUILTIN_TERMINAL_SCHEMES[0].colors, false);
