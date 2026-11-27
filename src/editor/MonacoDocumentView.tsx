import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { editor } from "monaco-editor";
import type { OnMount } from "@monaco-editor/react";
import { DocumentRegistry } from "./documentRegistry";
import { loadMonacoReact } from "./monacoReact";
import { loadMonaco, refreshMonacoTheme } from "../sftp/monacoLoader";
import { Button } from "../ui/Button";

export type MonacoDocuments = DocumentRegistry<editor.ITextModel, editor.ICodeEditorViewState>;

// The enclosing loader handles retry before these components are rendered.
const Editor = lazy(async () => ({ default: (await loadMonacoReact()).Editor }));
const DiffEditor = lazy(async () => ({ default: (await loadMonacoReact()).DiffEditor }));

function useMonacoReady() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ ready: boolean; theme?: string; failed?: boolean }>({ ready: false });
  useEffect(() => {
    let active = true;
    let observer: MutationObserver | undefined;
    setState({ ready: false });
    void loadMonacoReact().then(async () => {
      const monaco = await loadMonaco();
      if (!active) return;
      const update = () => setState({ ready: true, theme: refreshMonacoTheme(monaco) });
      update();
      observer = new MutationObserver(update);
      observer.observe(document.documentElement, {
        attributes: true, attributeFilter: ["data-theme", "style", "class"],
      });
    }).catch(() => { if (active) setState({ ready: false, failed: true }); });
    return () => { active = false; observer?.disconnect(); };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

function LoadMessage({ failed, retry }: { failed?: boolean; retry: () => void }) {
  return <div role={failed ? "alert" : "status"} className="remote-file-editor__message">
    {failed ? <>编辑器加载失败。<Button onClick={retry}>重试</Button></> : "正在加载编辑器…"}
  </div>;
}

interface DocumentViewProps {
  registry: MonacoDocuments;
  documentId: string;
  viewId: string;
  language: string;
  options?: editor.IStandaloneEditorConstructionOptions;
  onSave: () => void;
  saveShortcut?: boolean;
  onMount?: OnMount;
}

/** One mounted view. Its owner keeps the registry alive when navigating away. */
export function MonacoDocumentView(props: DocumentViewProps) {
  // A new view component for each document keeps cleanup bound to the right model.
  return <DocumentView key={`${props.viewId}:${props.documentId}`} {...props} />;
}

function DocumentView({ registry, documentId, viewId, language, options, onSave, onMount, saveShortcut = true }: DocumentViewProps) {
  useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const document = registry.get(documentId);
  const loaded = useMonacoReady();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const saveRef = useRef(onSave);
  const scrollListener = useRef<{ dispose(): void } | null>(null);
  saveRef.current = onSave;

  useEffect(() => {
    if (!registry.get(documentId)) return;
    registry.retainView(documentId, viewId);
    return () => {
      const instance = editorRef.current;
      if (instance && registry.get(documentId) && instance.getModel()) {
        registry.saveViewState(documentId, viewId, instance.saveViewState());
      }
      scrollListener.current?.dispose();
      registry.releaseView(documentId, viewId);
      editorRef.current = null;
    };
  }, [registry, documentId, viewId]);

  if (!document) return null;
  if (!loaded.ready) return <LoadMessage failed={loaded.failed} retry={loaded.retry} />;
  return <Suspense fallback={<LoadMessage retry={loaded.retry} />}>
    <Editor
      path={document.uri}
      language={document.largeFile ? "plaintext" : language}
      keepCurrentModel
      saveViewState={false}
      theme={loaded.theme}
      options={{ automaticLayout: true, accessibilitySupport: "on", scrollBeyondLastLine: false,
        ...options, ...(document.largeFile ? { minimap: { enabled: false }, folding: false,
          bracketPairColorization: { enabled: false }, occurrencesHighlight: "off" as const,
          selectionHighlight: false, codeLens: false, colorDecorators: false,
          quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: "off" as const,
          renderValidationDecorations: "off" as const, links: false } : {}),
        readOnly: document.readOnly || options?.readOnly }}
      onMount={(instance, monaco) => {
        editorRef.current = instance;
        // The React wrapper reuses registry-owned models without applying its
        // initial language prop; its update effect only handles later changes.
        monaco.editor.setModelLanguage(document.model, document.largeFile ? "plaintext" : language);
        const state = registry.retainView(documentId, viewId);
        if (state) instance.restoreViewState(state);
        scrollListener.current?.dispose();
        scrollListener.current = instance.onDidScrollChange(() => {
          if (registry.get(documentId)) registry.saveViewState(documentId, viewId, instance.saveViewState());
        });
        if (saveShortcut) instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
        onMount?.(instance, monaco);
      }}
    />
  </Suspense>;
}

export function MonacoComparisonView({ original, modified, language, inline = false, onMount }: {
  original: string; modified: string; language: string; inline?: boolean;
  onMount?: (instance: editor.IStandaloneDiffEditor) => void;
}) {
  const loaded = useMonacoReady();
  const instanceRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<editor.IDiffEditorModel | null>(null);
  useEffect(() => () => {
    // The wrapper disposes models before detaching them. Own these temporary
    // models so Monaco 0.56 never observes a disposed model still attached to a diff.
    instanceRef.current?.setModel(null);
    modelsRef.current?.original.dispose(); modelsRef.current?.modified.dispose();
    instanceRef.current = null; modelsRef.current = null;
  }, []);
  if (!loaded.ready) return <LoadMessage failed={loaded.failed} retry={loaded.retry} />;
  return <Suspense fallback={<LoadMessage retry={loaded.retry} />}>
    <DiffEditor original={original} modified={modified} language={language} theme={loaded.theme}
      keepCurrentOriginalModel keepCurrentModifiedModel
      options={{ automaticLayout: true, readOnly: true, originalEditable: false,
        renderSideBySide: !inline, accessibilitySupport: "on" }}
      onMount={(instance) => { instanceRef.current = instance; modelsRef.current = instance.getModel(); onMount?.(instance); }} />
  </Suspense>;
}
