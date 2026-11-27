import type * as Monaco from "monaco-editor";
export interface EditorSymbol {
  name: string;
  range: Monaco.IRange;
  selection: Monaco.IRange;
  children: EditorSymbol[];
}
const cache = new WeakMap<Monaco.editor.ITextModel, { version: number; language: string; request: Promise<EditorSymbol[]> }>();
function copySymbols(input: Monaco.languages.DocumentSymbol[], budget: { remaining: number }, depth = 0): EditorSymbol[] {
  if (depth > 24) return [];
  const result: EditorSymbol[] = [];
  for (const symbol of input) {
    if (--budget.remaining < 0) break;
    if (!symbol.range || !symbol.selectionRange) continue;
    result.push({ name: symbol.name.slice(0, 160), range: { ...symbol.range }, selection: { ...symbol.selectionRange }, children: copySymbols(symbol.children ?? [], budget, depth + 1) });
  }
  return result;
}
/** Version-specific access is isolated here; unavailable registries degrade to native outline. */
export function requestEditorSymbols(monaco: typeof Monaco, model: Monaco.editor.ITextModel): Promise<EditorSymbol[]> {
  if (model.isDisposed() || model.getValueLength() > 2 * 1024 * 1024) return Promise.resolve([]);
  const version = model.getVersionId(); const language = model.getLanguageId();
  const existing = cache.get(model); if (existing?.version === version && existing.language === language) return existing.request;
  const request = (async () => {
    const cancellation = new monaco.CancellationTokenSource(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [{ StandaloneServices }, { ILanguageFeaturesService }] = await Promise.all([
        import("monaco-editor/editor/standalone/browser/standaloneServices.js"),
        import("monaco-editor/editor/common/services/languageFeatures.js"),
      ]);
      if (model.isDisposed()) return [];
      const providers = StandaloneServices.get(ILanguageFeaturesService).documentSymbolProvider.ordered(model).slice(0, 4);
      const timeout = new Promise<EditorSymbol[]>((resolve) => { timer = setTimeout(() => { cancellation.cancel(); resolve([]); }, 1000); });
      const load = (async () => {
        for (const provider of providers) {
          const symbols = await provider.provideDocumentSymbols(model, cancellation.token);
          if (cancellation.token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version || model.getLanguageId() !== language) return [];
          if (symbols?.length) return copySymbols(symbols, { remaining: 2000 });
        }
        return [];
      })();
      return await Promise.race([load, timeout]);
    } catch { return []; }
    finally { if (timer) clearTimeout(timer); cancellation.dispose(true); }
  })();
  cache.set(model, { version, language, request });
  void request.then((symbols) => { if (!symbols.length && cache.get(model)?.request === request) cache.delete(model); });
  return request;
}
export function editorSymbolChain(symbols: EditorSymbol[], line: number, column: number): EditorSymbol[] {
  const contains = (range: Monaco.IRange) => (line > range.startLineNumber || (line === range.startLineNumber && column >= range.startColumn)) && (line < range.endLineNumber || (line === range.endLineNumber && column <= range.endColumn));
  const item = symbols.find((symbol) => contains(symbol.range));
  return item ? [item, ...editorSymbolChain(item.children, line, column)] : [];
}
