import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clampEditorTabSize,
  clampFontSize,
  EDITOR_INHERIT_TERMINAL_DEFAULT,
  EDITOR_LINE_NUMBERS_DEFAULT,
  EDITOR_MINIMAP_DEFAULT,
  EDITOR_TAB_SIZE_DEFAULT,
  EDITOR_WORD_WRAP_DEFAULT,
  editorFontFamilyKey,
  editorFontSizeKey,
  editorInheritTerminalKey,
  editorLineNumbersKey,
  editorMinimapKey,
  editorRenderWhitespaceKey,
  editorTabSizeKey,
  editorWordWrapKey,
  FONT_SIZE_DEFAULT,
  normalizeEditorRenderWhitespace,
  normalizeFontFamily,
  parseBoolean,
  type EditorOptions,
  type EditorRenderWhitespace,
} from "./settings";

function getStoredFontSize(): number {
  const raw = localStorage.getItem(editorFontSizeKey);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampFontSize(parsed) : FONT_SIZE_DEFAULT;
}

function getStoredTabSize(): number {
  const raw = localStorage.getItem(editorTabSizeKey);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampEditorTabSize(parsed) : EDITOR_TAB_SIZE_DEFAULT;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  inheritTerminal: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  options: EditorOptions;
  renderWhitespace: EditorRenderWhitespace;
  setFontFamily: (value: string) => void;
  setFontSize: (value: number) => void;
  setInheritTerminal: (value: boolean) => void;
  setLineNumbers: (value: boolean) => void;
  setMinimap: (value: boolean) => void;
  setRenderWhitespace: (value: EditorRenderWhitespace) => void;
  setTabSize: (value: number) => void;
  setWordWrap: (value: boolean) => void;
  tabSize: number;
  wordWrap: boolean;
}

/** Persists editor-only preferences. Font settings may inherit the terminal's
 * equivalent values, while Monaco-specific behavior stays independent. */
export function useEditorSettings(terminalFontFamily: string, terminalFontSize: number): EditorSettings {
  const [inheritTerminal, setInheritTerminalState] = useState(() =>
    parseBoolean(localStorage.getItem(editorInheritTerminalKey), EDITOR_INHERIT_TERMINAL_DEFAULT),
  );
  const [storedFontFamily, setStoredFontFamily] = useState(() =>
    normalizeFontFamily(localStorage.getItem(editorFontFamilyKey)),
  );
  const [storedFontSize, setStoredFontSize] = useState(getStoredFontSize);
  const [wordWrap, setWordWrapState] = useState(() =>
    parseBoolean(localStorage.getItem(editorWordWrapKey), EDITOR_WORD_WRAP_DEFAULT),
  );
  const [minimap, setMinimapState] = useState(() =>
    parseBoolean(localStorage.getItem(editorMinimapKey), EDITOR_MINIMAP_DEFAULT),
  );
  const [lineNumbers, setLineNumbersState] = useState(() =>
    parseBoolean(localStorage.getItem(editorLineNumbersKey), EDITOR_LINE_NUMBERS_DEFAULT),
  );
  const [tabSize, setTabSizeState] = useState(getStoredTabSize);
  const [renderWhitespace, setRenderWhitespaceState] = useState<EditorRenderWhitespace>(() =>
    normalizeEditorRenderWhitespace(localStorage.getItem(editorRenderWhitespaceKey)),
  );

  useEffect(() => { localStorage.setItem(editorInheritTerminalKey, String(inheritTerminal)); }, [inheritTerminal]);
  useEffect(() => { localStorage.setItem(editorFontFamilyKey, storedFontFamily); }, [storedFontFamily]);
  useEffect(() => { localStorage.setItem(editorFontSizeKey, String(storedFontSize)); }, [storedFontSize]);
  useEffect(() => { localStorage.setItem(editorWordWrapKey, String(wordWrap)); }, [wordWrap]);
  useEffect(() => { localStorage.setItem(editorMinimapKey, String(minimap)); }, [minimap]);
  useEffect(() => { localStorage.setItem(editorLineNumbersKey, String(lineNumbers)); }, [lineNumbers]);
  useEffect(() => { localStorage.setItem(editorTabSizeKey, String(tabSize)); }, [tabSize]);
  useEffect(() => { localStorage.setItem(editorRenderWhitespaceKey, renderWhitespace); }, [renderWhitespace]);

  const setInheritTerminal = useCallback((value: boolean) => {
    if (!value) {
      setStoredFontFamily(terminalFontFamily);
      setStoredFontSize(terminalFontSize);
    }
    setInheritTerminalState(value);
  }, [terminalFontFamily, terminalFontSize]);
  const setFontFamily = useCallback((value: string) => setStoredFontFamily(normalizeFontFamily(value)), []);
  const setFontSize = useCallback((value: number) => setStoredFontSize(clampFontSize(value)), []);
  const setWordWrap = useCallback((value: boolean) => setWordWrapState(value), []);
  const setMinimap = useCallback((value: boolean) => setMinimapState(value), []);
  const setLineNumbers = useCallback((value: boolean) => setLineNumbersState(value), []);
  const setTabSize = useCallback((value: number) => setTabSizeState(clampEditorTabSize(value)), []);
  const setRenderWhitespace = useCallback((value: EditorRenderWhitespace) => setRenderWhitespaceState(value), []);

  const fontFamily = inheritTerminal ? terminalFontFamily : storedFontFamily;
  const fontSize = inheritTerminal ? terminalFontSize : storedFontSize;
  const options = useMemo<EditorOptions>(() => ({
    fontFamily,
    fontSize,
    lineNumbers: lineNumbers ? "on" : "off",
    minimap,
    renderWhitespace,
    tabSize,
    wordWrap: wordWrap ? "on" : "off",
  }), [fontFamily, fontSize, lineNumbers, minimap, renderWhitespace, tabSize, wordWrap]);

  return {
    fontFamily,
    fontSize,
    inheritTerminal,
    lineNumbers,
    minimap,
    options,
    renderWhitespace,
    setFontFamily,
    setFontSize,
    setInheritTerminal,
    setLineNumbers,
    setMinimap,
    setRenderWhitespace,
    setTabSize,
    setWordWrap,
    tabSize,
    wordWrap,
  };
}
