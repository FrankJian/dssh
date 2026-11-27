import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { editor } from "monaco-editor";
import { DocumentRegistry, isDocumentDirty } from "../../src/editor/documentRegistry";
import { MonacoDocumentView, MonacoComparisonView } from "../../src/editor/MonacoDocumentView";
import { loadMonaco } from "../../src/sftp/monacoLoader";
import "../../src/theme/global.css";

const monaco = await loadMonaco();
const registry = new DocumentRegistry<editor.ITextModel, editor.ICodeEditorViewState>("fixture", (content, uri) => monaco.editor.createModel(content, "typescript", monaco.Uri.parse(uri)));
const a = registry.open({ source: { kind: "local" }, path: "/one.ts", content: Array.from({ length: 100 }, (_, i) => `const item${i} = ${i};`).join("\n"), encoding: "utf-8", lineEnding: "lf", bom: false, versionToken: "one", readOnly: false });
const b = registry.open({ source: { kind: "local" }, path: "/two.ts", content: "const other = 2;", encoding: "utf-8", lineEnding: "lf", bom: false, versionToken: "two", readOnly: false });
const editors: Record<string, editor.IStandaloneCodeEditor> = {};
const api = { registry, a: a.id, b: b.id, editors, monaco,
  dirty: () => isDocumentDirty(registry.get(a.id)!),
  saves: 0,
};
declare global { interface Window { editorFixture: typeof api } }
window.editorFixture = api;

function Fixture() {
  const [selected, select] = useState(a.id);
  const [right, setRight] = useState(true);
  const [diff, setDiff] = useState(false);
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <nav>
      <button onClick={() => select(a.id)}>文件 A</button><button onClick={() => select(b.id)}>文件 B</button>
      <button onClick={() => setRight((v) => !v)}>切换右组</button><button onClick={() => setDiff((v) => !v)}>比较</button>
      <button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>主题</button>
    </nav>
    <section style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div data-testid="left" style={{ flex: 1, minWidth: 0 }}><MonacoDocumentView registry={registry} documentId={selected} viewId="left" language="typescript" onSave={() => { api.saves++; }} onMount={(instance) => { editors.left = instance; }} /></div>
      {right && <div data-testid="right" style={{ flex: 1, minWidth: 0 }}><MonacoDocumentView registry={registry} documentId={a.id} viewId="right" language="typescript" onSave={() => { api.saves++; }} onMount={(instance) => { editors.right = instance; }} /></div>}
      {diff && <div data-testid="diff" style={{ flex: 1, minWidth: 0 }}><MonacoComparisonView original="before" modified="after" language="plaintext" /></div>}
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
