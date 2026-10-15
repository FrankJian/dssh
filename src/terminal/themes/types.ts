export type TerminalColorField =
  | "foreground"
  | "background"
  | "cursor"
  | "cursorAccent"
  | "selectionBackground"
  | "selectionInactiveBackground"
  | "selectionForeground"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

export type TerminalColors = Record<Exclude<TerminalColorField, "selectionForeground">, string> & {
  selectionForeground: string | null;
};

export type TerminalThemeKind = "dark" | "light";

export interface BuiltinTerminalScheme {
  id: `builtin:${string}`;
  name: string;
  kind: TerminalThemeKind;
  colors: TerminalColors;
}

export interface CustomTerminalScheme {
  id: `custom:${string}`;
  name: string;
  kind: TerminalThemeKind;
  sourcePresetId: string;
  baseColors: TerminalColors;
  colors: TerminalColors;
}

export interface TerminalThemePreferencesV1 {
  schemaVersion: 1;
  revision: number;
  /** Legacy fixed selection, retained when the user turns off appearance sync. */
  activeSchemeId: string;
  /** Use a matching terminal palette for the application's resolved appearance. */
  followAppearance: boolean;
  darkSchemeId: string;
  lightSchemeId: string;
  customSchemes: CustomTerminalScheme[];
}

export interface TerminalThemeStoreState {
  preferences: TerminalThemePreferencesV1;
  storageError: string | null;
  readOnly: boolean;
}
