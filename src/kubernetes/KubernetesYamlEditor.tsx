import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorOptions } from "../settings/settings";
import { loadMonaco, refreshMonacoTheme } from "../sftp/monacoLoader";

interface KubernetesYamlEditorProps {
  content: string;
  editorOptions: EditorOptions;
  resourceId: string;
  onChange: (content: string) => void;
}

/** Dedicated Kubernetes YAML Monaco model. It never reads or writes SFTP paths. */
export function KubernetesYamlEditor({ content, editorOptions, resourceId, onChange }: KubernetesYamlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    void loadMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;
      const uri = monaco.Uri.from({ scheme: "dssh-k8s", authority: "workspace", path: `/${encodeURIComponent(resourceId)}.yaml` });
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, "yaml", uri);
      const editor = monaco.editor.create(hostRef.current, {
        automaticLayout: true, bracketPairColorization: { enabled: true }, folding: true,
        fontFamily: editorOptions.fontFamily, fontSize: editorOptions.fontSize,
        lineNumbers: editorOptions.lineNumbers, minimap: { enabled: editorOptions.minimap },
        padding: { top: 10, bottom: 10 }, renderWhitespace: editorOptions.renderWhitespace,
        scrollBeyondLastLine: false, tabSize: editorOptions.tabSize, wordWrap: editorOptions.wordWrap,
      });
      editor.setModel(model);
      model.onDidChangeContent(() => onChangeRef.current(model.getValue()));
      editorRef.current = editor; modelRef.current = model;
    }).catch((reason: unknown) => !disposed && setError(reason instanceof Error ? reason.message : "Kubernetes YAML 编辑器加载失败。"));
    return () => { disposed = true; editorRef.current?.dispose(); editorRef.current = null; modelRef.current?.dispose(); modelRef.current = null; };
  }, [resourceId]);

  useEffect(() => { if (modelRef.current && modelRef.current.getValue() !== content) modelRef.current.setValue(content); }, [content]);
  useEffect(() => { editorRef.current?.updateOptions({ fontFamily: editorOptions.fontFamily, fontSize: editorOptions.fontSize, lineNumbers: editorOptions.lineNumbers, minimap: { enabled: editorOptions.minimap }, renderWhitespace: editorOptions.renderWhitespace, tabSize: editorOptions.tabSize, wordWrap: editorOptions.wordWrap }); }, [editorOptions]);
  useEffect(() => { const observer = new MutationObserver(() => { if (editorRef.current) void loadMonaco().then(refreshMonacoTheme); }); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); return () => observer.disconnect(); }, []);
  return <div className="kubernetes-yaml-editor"><div aria-label="Kubernetes YAML 编辑器" className="kubernetes-yaml-editor__host" ref={hostRef} />{error ? <p>{error}</p> : null}</div>;
}
