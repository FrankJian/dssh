import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorOptions } from "../settings/settings";
import { loadMonaco, refreshMonacoTheme } from "./monacoLoader";

interface MonacoDocument {
  content: string;
  error: string | null;
  isLoading: boolean;
}

interface MonacoRemoteEditorProps {
  activePath: string | null;
  documents: Record<string, MonacoDocument>;
  editorOptions: EditorOptions;
  filePaths: string[];
  hidden: boolean;
  languageOverrides: Record<string, string>;
  onContentChange: (path: string, content: string) => void;
  onSave: () => void;
  onScroll?: (scrollTop: number, maxScrollTop: number) => void;
  profileId: string;
  scrollTop?: number;
  shouldLoad: boolean;
}

interface ModelEntry {
  changeListener: Monaco.IDisposable;
  model: Monaco.editor.ITextModel;
}

export const EDITOR_LANGUAGE_OPTIONS = [
  { id: "plaintext", label: "纯文本" },
  { id: "shell", label: "Shell" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "css", label: "CSS" },
  { id: "go", label: "Go" },
  { id: "html", label: "HTML" },
  { id: "ini", label: "INI / TOML" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "kotlin", label: "Kotlin" },
  { id: "lua", label: "Lua" },
  { id: "markdown", label: "Markdown" },
  { id: "php", label: "PHP" },
  { id: "python", label: "Python" },
  { id: "r", label: "R" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "typescript", label: "TypeScript" },
  { id: "xml", label: "XML / SVG" },
  { id: "yaml", label: "YAML" },
] as const;

export function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const languageByExtension: Record<string, string> = {
    bash: "shell",
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "cpp",
    htm: "html",
    html: "html",
    ini: "ini",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    kt: "kotlin",
    lua: "lua",
    md: "markdown",
    php: "php",
    py: "python",
    r: "r",
    rs: "rust",
    sh: "shell",
    sql: "sql",
    svg: "xml",
    toml: "ini",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "shell",
  };
  return languageByExtension[extension ?? ""] ?? "plaintext";
}

export function languageLabel(languageId: string): string {
  return EDITOR_LANGUAGE_OPTIONS.find((option) => option.id === languageId)?.label ?? languageId;
}

function disposeEntry(entry: ModelEntry) {
  entry.changeListener.dispose();
  entry.model.dispose();
}

/** Monaco surface kept mounted for the lifetime of RemoteFileEditor so models
 * persist while users switch editor tabs, image previews and Markdown preview. */
export function MonacoRemoteEditor({
  activePath,
  documents,
  editorOptions,
  filePaths,
  hidden,
  languageOverrides,
  onContentChange,
  onSave,
  onScroll,
  profileId,
  scrollTop = 0,
  shouldLoad,
}: MonacoRemoteEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const modelsRef = useRef<Map<string, ModelEntry>>(new Map());
  const profileRef = useRef(profileId);
  const onContentChangeRef = useRef(onContentChange);
  const onSaveRef = useRef(onSave);
  const onScrollRef = useRef(onScroll);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  onContentChangeRef.current = onContentChange;
  onSaveRef.current = onSave;
  onScrollRef.current = onScroll;

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let scrollListener: Monaco.IDisposable | null = null;
    void loadMonaco()
      .then((monaco) => {
        if (disposed || !hostRef.current) return;
        monacoRef.current = monaco;
        const editor = monaco.editor.create(hostRef.current, {
          accessibilitySupport: "on",
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          folding: true,
          fontFamily: editorOptions.fontFamily,
          fontSize: editorOptions.fontSize,
          lineNumbers: editorOptions.lineNumbers,
          lineNumbersMinChars: 3,
          minimap: { enabled: editorOptions.minimap },
          padding: { top: 10, bottom: 10 },
          renderWhitespace: editorOptions.renderWhitespace,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: editorOptions.tabSize,
          wordWrap: editorOptions.wordWrap,
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current());
        scrollListener = editor.onDidScrollChange((event) => {
          const maxScrollTop = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height);
          onScrollRef.current?.(event.scrollTop, maxScrollTop);
        });
        editorRef.current = editor;
        resizeObserver = new ResizeObserver(() => editor.layout());
        resizeObserver.observe(hostRef.current);
        setIsReady(true);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : "代码编辑器加载失败。");
      });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      scrollListener?.dispose();
      for (const entry of modelsRef.current.values()) disposeEntry(entry);
      modelsRef.current.clear();
      editorRef.current?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
      setIsReady(false);
    };
  }, [shouldLoad]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    editorRef.current?.setScrollTop(scrollTop);
  }, [isReady, scrollTop]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontFamily: editorOptions.fontFamily,
      fontSize: editorOptions.fontSize,
      lineNumbers: editorOptions.lineNumbers,
      minimap: { enabled: editorOptions.minimap },
      renderWhitespace: editorOptions.renderWhitespace,
      tabSize: editorOptions.tabSize,
      wordWrap: editorOptions.wordWrap,
    });
  }, [editorOptions]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (monacoRef.current) refreshMonacoTheme(monacoRef.current);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    if (profileRef.current !== profileId) {
      for (const entry of modelsRef.current.values()) disposeEntry(entry);
      modelsRef.current.clear();
      profileRef.current = profileId;
    }

    for (const [path, document] of Object.entries(documents)) {
      if (document.isLoading || document.error || modelsRef.current.has(path)) continue;
      const uri = monaco.Uri.from({ authority: profileId, path: path.startsWith("/") ? path : `/${path}`, scheme: "dssh-sftp" });
      const model = monaco.editor.createModel(
        document.content,
        languageOverrides[path] ?? languageForPath(path),
        uri,
      );
      const changeListener = model.onDidChangeContent(() => onContentChangeRef.current(path, model.getValue()));
      modelsRef.current.set(path, { changeListener, model });
    }

    for (const [path, entry] of modelsRef.current) {
      const document = documents[path];
      if (!filePaths.includes(path) || !document || document.isLoading || document.error) {
        disposeEntry(entry);
        modelsRef.current.delete(path);
        continue;
      }
      const languageId = languageOverrides[path] ?? languageForPath(path);
      if (entry.model.getLanguageId() !== languageId) {
        monaco.editor.setModelLanguage(entry.model, languageId);
      }
    }

    const activeModel = activePath ? modelsRef.current.get(activePath)?.model ?? null : null;
    if (editorRef.current?.getModel() !== activeModel) {
      editorRef.current?.setModel(activeModel);
      if (activeModel) editorRef.current?.focus();
    }
    if (editorRef.current) {
      const maxScrollTop = Math.max(
        0,
        editorRef.current.getScrollHeight() - editorRef.current.getLayoutInfo().height,
      );
      onScrollRef.current?.(editorRef.current.getScrollTop(), maxScrollTop);
    }
  }, [activePath, documents, filePaths, isReady, languageOverrides, profileId]);

  useEffect(() => {
    if (!hidden) editorRef.current?.layout();
  }, [hidden]);

  return (
    <div className="remote-file-editor__monaco" data-hidden={hidden}>
      <div aria-label="远程文件内容" className="remote-file-editor__monaco-host" ref={hostRef} />
      {error ? <p className="remote-file-editor__message remote-file-editor__message--error">{error}</p> : null}
    </div>
  );
}
