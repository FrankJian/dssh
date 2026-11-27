import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import { Icon } from "../ui/Icon";
import { Fragment } from "react";
import { EditorActionMenu, type EditorMenuItem } from "./EditorActionMenu";
import { editorSymbolChain, requestEditorSymbols, type EditorSymbol } from "./documentSymbols";
export function EditorSymbolBreadcrumbs({ monaco, model, position, enabled, onSelect }: {
  monaco: typeof Monaco; model: Monaco.editor.ITextModel; position: Monaco.IPosition; enabled: boolean; onSelect(line: number, column: number): void;
}) {
  const [symbols, setSymbols] = useState<EditorSymbol[]>([]);
  useEffect(() => {
    let alive = true; let generation = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const request = ++generation; if (timer) clearTimeout(timer); setSymbols([]);
      if (enabled) {
        const load = (retry: boolean) => { void requestEditorSymbols(monaco, model).then((items) => {
          if (!alive || generation !== request) return;
          setSymbols(items);
          if (!items.length && retry && model.getLanguageId() !== "plaintext") timer = setTimeout(() => load(false), 600);
        }); };
        timer = setTimeout(() => load(true), 300);
      }
    };
    const content = model.onDidChangeContent(schedule); const language = model.onDidChangeLanguage(schedule); schedule();
    return () => { alive = false; ++generation; if (timer) clearTimeout(timer); content.dispose(); language.dispose(); };
  }, [monaco, model, enabled]);
  const chain = editorSymbolChain(symbols, position.lineNumber, position.column);
  const entries = (items: EditorSymbol[]): EditorMenuItem[] => items.map((symbol, index) => ({ id: String(index), label: symbol.name, run: () => onSelect(symbol.selection.startLineNumber, symbol.selection.startColumn) }));
  if (!enabled || !chain.length) return null;
  return <span className="editor-symbol-breadcrumbs" aria-label="符号面包屑">
    {chain.map((symbol, index) => <Fragment key={`${index}:${symbol.name}`}>{index ? <Icon name="chevron-right" width="12" height="12" /> : null}<EditorActionMenu label={symbol.name} items={() => entries(index ? chain[index - 1].children : symbols)} /></Fragment>)}
  </span>;
}
