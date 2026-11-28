import type * as Monaco from "monaco-editor";
import CssWorker from "../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import EditorWorker from "../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import HtmlWorker from "../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import JsonWorker from "../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker";
import TypeScriptWorker from "../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

type MonacoApi = typeof Monaco;
type MonacoWorker = new () => Worker;

let loader: Promise<MonacoApi> | null = null;

let colorContext: CanvasRenderingContext2D | null = null;
function cssColor(name: string): string {
  // Monaco parses theme colors as hex, while app palettes also use rgb()/color-mix().
  const value = name.startsWith("--") ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : name;
  if (!colorContext) { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; colorContext = canvas.getContext("2d", { willReadFrequently: true }); }
  if (!colorContext) throw new Error("无法初始化编辑器主题颜色。");
  colorContext.clearRect(0, 0, 1, 1); colorContext.fillStyle = "#000000"; colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  return "#" + Array.from(colorContext.getImageData(0, 0, 1, 1).data, byte => byte.toString(16).padStart(2, "0")).join("");
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
      "editorWidget.foreground": cssColor("--text-base"),
      "widget.border": cssColor("--border-subtle"),
      "focusBorder": cssColor("--accent-border"),
      "disabledForeground": cssColor("--text-faint"),
      "input.background": cssColor("--bg-app"),
      "input.foreground": cssColor("--text-base"),
      "input.border": cssColor("--border-subtle"),
      "input.placeholderForeground": cssColor("--text-faint"),
      "inputOption.activeBackground": cssColor("--bg-selected"),
      "inputOption.activeForeground": cssColor("--accent-strong"),
      "inputOption.activeBorder": cssColor("--border-subtle"),
      "inputOption.hoverBackground": cssColor("--bg-hover"),
      "toolbar.hoverBackground": cssColor("--bg-hover"),
      "inputValidation.errorBackground": cssColor("--bg-app"),
      "inputValidation.errorForeground": cssColor("--text-base"),
      "inputValidation.errorBorder": cssColor("--danger"),
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
    loader = import("monaco-editor").then(async (monaco) => {
      const { installMonacoFindHoverLayer } = await import("./monacoFindHover");
      await installMonacoFindHoverLayer();
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
    }).catch((error: unknown) => {
      loader = null;
      throw error;
    });
  }
  return loader;
}

export function refreshMonacoTheme(monaco: MonacoApi): string {
  return applyTheme(monaco);
}
