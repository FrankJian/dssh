import type * as Monaco from "monaco-editor";
import CssWorker from "../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import EditorWorker from "../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import HtmlWorker from "../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import JsonWorker from "../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker";
import TypeScriptWorker from "../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

type MonacoApi = typeof Monaco;
type MonacoWorker = new () => Worker;

let loader: Promise<MonacoApi> | null = null;

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTheme(monaco: MonacoApi) {
  const isLight = document.documentElement.dataset.theme === "light";
  const themeName = isLight ? "dssh-graphite-light" : "dssh-graphite-dark";
  monaco.editor.defineTheme(themeName, {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: cssColor("--code-comment") },
      { token: "keyword", foreground: cssColor("--code-keyword") },
      { token: "string", foreground: cssColor("--code-string") },
      { token: "number", foreground: cssColor("--code-number") },
      { token: "type", foreground: cssColor("--code-type") },
    ],
    colors: {
      "editor.background": cssColor("--bg-sunken"),
      "editor.foreground": cssColor("--text-base"),
      "editorLineNumber.foreground": cssColor("--text-faint"),
      "editorLineNumber.activeForeground": cssColor("--text-muted"),
      "editorCursor.foreground": cssColor("--accent-strong"),
      "editor.selectionBackground": cssColor("--code-selection"),
      "editor.inactiveSelectionBackground": cssColor("--code-selection-inactive"),
      "editor.lineHighlightBackground": cssColor("--code-line-highlight"),
      "editorGutter.background": cssColor("--bg-sunken"),
      "editorIndentGuide.background1": cssColor("--code-indent"),
      "editorIndentGuide.activeBackground1": cssColor("--border-strong"),
      "editorWidget.background": cssColor("--bg-elevated"),
      "editorWidget.border": cssColor("--border-subtle"),
      "editorSuggestWidget.background": cssColor("--bg-elevated"),
      "editorSuggestWidget.selectedBackground": cssColor("--bg-selected"),
      "editor.findMatchBackground": cssColor("--code-find-match"),
      "editor.findMatchHighlightBackground": cssColor("--code-find-match-highlight"),
    },
  });
  monaco.editor.setTheme(themeName);
  return themeName;
}

/** Loads Monaco only when a text document is ready. Worker constructors are
 * emitted as isolated ESM assets and instantiated only for the requested
 * language service. */
export function loadMonaco(): Promise<MonacoApi> {
  if (!loader) {
    loader = import("monaco-editor").then((monaco) => {
      const workerByLabel: Record<string, MonacoWorker> = {
        css: CssWorker,
        html: HtmlWorker,
        json: JsonWorker,
        javascript: TypeScriptWorker,
        typescript: TypeScriptWorker,
      };
      (self as typeof self & { MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker } }).MonacoEnvironment = {
        getWorker: (_moduleId, label) => new (workerByLabel[label] ?? EditorWorker)(),
      };
      applyTheme(monaco);
      return monaco;
    });
  }
  return loader;
}

export function refreshMonacoTheme(monaco: MonacoApi): string {
  return applyTheme(monaco);
}
