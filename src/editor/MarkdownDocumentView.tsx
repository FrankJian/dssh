import { Component, cloneElement, isValidElement, lazy, Suspense, useRef, type ReactNode } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { MonacoDocuments } from "./MonacoDocumentView";
import { RICH_MARKDOWN_LIMIT } from "./richMarkdownLimit";
import { Button } from "../ui/Button";
import type { MarkdownMode } from "./markdownMode";

export interface RichMarkdownHandle {
  documentId: string;
  focus(): void;
  execute(id: string): boolean;
  setReadOnly(value: boolean): void;
}
export interface RichMarkdownProps {
  registry: MonacoDocuments; documentId: string; viewId: string; disabled: boolean;
  onMount(handle: RichMarkdownHandle): void; onUnmount(handle: RichMarkdownHandle): void;
  toolbarContainer?: HTMLElement | null;
  onSource(): void;
  onSourceCommand(id: string): void;
}
const RichView = lazy(() => import("./RichMarkdownView").then(module => ({ default: module.RichMarkdownView })));
class RichBoundary extends Component<{ children: ReactNode; onSource(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="editor-empty" role="alert">Markdown 编辑器加载失败。<Button onClick={this.props.onSource}>使用源码编辑</Button></div> : this.props.children; }
}
export function MarkdownDocumentView({ source, mode, onModeChange, ...props }: Omit<RichMarkdownProps, "onSource" | "onSourceCommand"> & { source: ReactNode; mode: MarkdownMode; onModeChange(mode: MarkdownMode): void }) {
  const root = useRef<HTMLDivElement>(null);
  const sourceCommand = useRef<string | null>(null);
  const file = props.registry.get(props.documentId);
  const tooLarge = !file || file.largeFile || file.model.getValueLength() > RICH_MARKDOWN_LIMIT;
  const change = (value: "rich" | "source") => {
    if (props.disabled || (value === "rich" && tooLarge)) return;
    onModeChange(value);
  };
  const sourceView = isValidElement<{ onMount?: OnMount }>(source) ? cloneElement(source, { onMount: (instance, monaco) => {
    source.props.onMount?.(instance, monaco);
    const command = sourceCommand.current; sourceCommand.current = null;
    if (command) { instance.focus(); void instance.getAction(command)?.run(); }
  } }) : source;
  return <div className="editor-markdown-document" ref={root}>
    {tooLarge && mode === "rich" ? <div role="status" className="editor-rich-notice">此文档超过富文本编辑预算，已使用源码编辑。</div> : null}
    {mode === "rich" && !tooLarge ? <RichBoundary onSource={() => change("source")}>
      <Suspense fallback={<div className="editor-empty" role="status">正在加载 Markdown 编辑器…</div>}><RichView key={props.documentId} {...props} onSource={() => change("source")} onSourceCommand={(id) => { sourceCommand.current = id === "editorRevealSource" ? null : id; change("source"); }} /></Suspense>
    </RichBoundary> : sourceView}
  </div>;
}
