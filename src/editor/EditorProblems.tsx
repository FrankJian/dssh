import { useEffect, useState } from "react";
import type { editor } from "monaco-editor";
import type { loadMonaco } from "../sftp/monacoLoader";
import type { MonacoDocuments } from "./MonacoDocumentView";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/Icon";
export function EditorProblems({ monaco, registry, onOpen, onClose }: {
  monaco: Awaited<ReturnType<typeof loadMonaco>>; registry: MonacoDocuments;
  onOpen(id: string, line: number, column: number): void; onClose(): void;
}) {
  const [markers, setMarkers] = useState<Array<{ id: string; path: string; marker: editor.IMarker }>>([]);
  useEffect(() => {
    function update() {
      setMarkers(registry.list().flatMap((document) => monaco.editor.getModelMarkers({ resource: document.model.uri }).map((marker) => ({ id: document.id, path: document.identity?.path ?? "未命名", marker }))).slice(0, 500));
    }
    update(); const listener = monaco.editor.onDidChangeMarkers(update); const unsubscribe = registry.subscribe(update);
    return () => { listener.dispose(); unsubscribe(); };
  }, [monaco, registry]);
  return <section className="editor-problems" aria-label="问题列表"><header><strong>问题 · {markers.length}{markers.length === 500 ? "+" : ""}</strong><IconButton label="关闭问题列表" onClick={onClose}><Icon name="close" /></IconButton></header>
    <div className="editor-problems__list">{markers.length ? markers.map(({ id, path, marker }, index) => <Button variant="ghost" key={`${id}:${index}`} onClick={() => onOpen(id, marker.startLineNumber, marker.startColumn)}>
      <Icon name={marker.severity === monaco.MarkerSeverity.Error ? "close" : "info"} width="14" height="14" /><span>{marker.severity === monaco.MarkerSeverity.Error ? "错误：" : marker.severity === monaco.MarkerSeverity.Warning ? "警告：" : "提示："}{marker.message}</span><small>{path}:{marker.startLineNumber}:{marker.startColumn}</small>
    </Button>) : <p>当前已加载文档没有问题。</p>}</div></section>;
}
