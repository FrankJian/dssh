/** Minimal boundary for the installed Monaco 0.56 outline provider registry. */
declare module "monaco-editor/editor/standalone/browser/standaloneServices.js" {
  export const StandaloneServices: { get(id: unknown): { documentSymbolProvider: { ordered(model: import("monaco-editor").editor.ITextModel): import("monaco-editor").languages.DocumentSymbolProvider[] } } };
}
declare module "monaco-editor/editor/common/services/languageFeatures.js" { export const ILanguageFeaturesService: unknown; }
