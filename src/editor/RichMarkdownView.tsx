import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { Selection } from "@tiptap/pm/state";
import type { NodeViewConstructor } from "@tiptap/pm/view";
import { Editor } from "@tiptap/core";
import { Button } from "../ui/Button";
import { EditorActionMenu, type EditorMenuItem } from "./EditorActionMenu";
import { MermaidDiagram } from "../sftp/MermaidDiagram";
import { richMarkdownExtensions } from "./richMarkdownExtensions";
import { useEditorDialogs } from "./useEditorDialogs";
import { RichMarkdownAdapter, markdownChange, richMarkdownPaste } from "./richMarkdown";
import { fenceLanguageCompletion } from "./fenceLanguageCompletion";
import { CodeBlockLanguage } from "./CodeBlockLanguage";
import type { RichMarkdownHandle, RichMarkdownProps } from "./MarkdownDocumentView";


export function RichMarkdownView({ registry, documentId, viewId, disabled, onMount, onUnmount, onSource, onSourceCommand, toolbarContainer }: RichMarkdownProps) {
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const instance = useRef<Editor | null>(null);
  const renderEnabled = useRef(!disabled); renderEnabled.current = !disabled;
  const readOnly = disabled || !!registry.get(documentId)?.readOnly;
  const allowed = useRef(!readOnly); allowed.current = !readOnly;
  const callbacks = useRef({ onMount, onUnmount, onSourceCommand }); callbacks.current = { onMount, onUnmount, onSourceCommand };
  const refreshDiagrams = useRef(new Set<() => void>());
  const dialogs = useEditorDialogs("Markdown");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, refresh] = useState(0);
  useEffect(() => {
    const file = registry.get(documentId), element = host.current; if (!file || !element) return;
    let editor: Editor | undefined, handle: RichMarkdownHandle | undefined;
    let failed = false, syncing = false, ownChange = false, pendingExternal = false, original = file.model.getValue();
    const adapter = new RichMarkdownAdapter();
    const editable = () => !failed && allowed.current && !!registry.get(documentId) && !registry.get(documentId)!.readOnly;
    registry.retainView(documentId, viewId);
    const acceptExternal = () => {
      if (!editor || ownChange || !registry.get(documentId)) return;
      const next = file.model.getValue(); if (next === original) return;
      if (editor.view.composing) { pendingExternal = true; return; }
      syncing = true;
      try {
        const position = editor.state.selection.from;
        editor.commands.setContent(adapter.parse(next, editor.markdown!, node => editor!.schema.nodeFromJSON(node).toJSON()), { emitUpdate: false });
        editor.commands.setTextSelection(Math.min(position, editor.state.doc.content.size)); original = next;
        pendingExternal = false;
      } catch { failed = true; setError("正文已变化，暂时无法在所见即所得模式显示，请使用源码编辑。"); editor.setEditable(false); }
      finally { syncing = false; }
    };
    const endComposition = () => { if (pendingExternal) queueMicrotask(acceptExternal); };
    const codeNodeView: NodeViewConstructor = (node, view, getPos) => {
            const dom = document.createElement("div"); dom.className = "editor-rich-code";
            const pre = dom.appendChild(document.createElement("pre")), code = pre.appendChild(document.createElement("code"));
            const toolbar = dom.appendChild(document.createElement("div")); toolbar.className = "editor-rich-code__toolbar"; toolbar.contentEditable = "false";
            const languageRoot = createRoot(toolbar);
            const chart = dom.appendChild(document.createElement("div")); chart.contentEditable = "false";
            const root = createRoot(chart); let current = node;
            const render = () => {
              const language = String(current.attrs.language ?? "");
              const isDiagram = /^(mermaid|mamerid)$/i.test(language); chart.hidden = !isDiagram;
              code.dataset.language = language;
              languageRoot.render(<CodeBlockLanguage language={language} disabled={!editable()} onChange={value => {
                const pos = getPos(); if (!editable() || typeof pos !== "number" || view.state.doc.nodeAt(pos)?.type !== current.type) return;
                file.model.pushStackElement();
                view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language: value || null }));
                file.model.pushStackElement();
                queueMicrotask(() => { if (editable()) editor?.commands.focus(undefined, { scrollIntoView: false }); });
              }} />);
              root.render(isDiagram ? <MermaidDiagram chart={current.textContent} enabled={renderEnabled.current} /> : null);
            };
            refreshDiagrams.current.add(render); render();
            return { dom, contentDOM: code, update(next) { if (next.type !== node.type) return false; current = next; render(); return true; },
              stopEvent: event => event.target instanceof globalThis.Node && toolbar.contains(event.target),
              ignoreMutation: mutation => mutation.type !== "selection" && (chart.contains(mutation.target) || toolbar.contains(mutation.target)),
              destroy() { refreshDiagrams.current.delete(render); queueMicrotask(() => { root.unmount(); languageRoot.unmount(); }); } };
    };
    try {
      editor = new Editor({
        element,
        extensions: richMarkdownExtensions(),
        editable: editable(), content: "",
        editorProps: {
          attributes: { role: "textbox", "aria-label": "Markdown 所见即所得编辑器", "aria-multiline": "true", spellcheck: "false" },
          handleDOMEvents: {
            paste: (view, event) => {
              if (!editable()) return true;
              const text = event.clipboardData?.getData("text/plain"); if (text === undefined) return true;
              event.preventDefault();
              if (view.composing) { setNotice("请先完成当前输入，再粘贴代码块。"); return true; }
              try {
                file.model.pushStackElement();
                if (view.state.selection.$from.parent.type.name !== "codeBlock" && /^ {0,3}(?:`{3,}|~{3,})/m.test(text) && !/^ {0,3}```[a-zA-Z0-9_+#.-]*$/.test(text)) {
                  const content = richMarkdownPaste(text, editor!.markdown!, node => editor!.schema.nodeFromJSON(node).toJSON());
                  editor!.commands.insertContent(content);
                } else view.dispatch(view.state.tr.insertText(text));
                file.model.pushStackElement();
              } catch { setNotice("无法安全粘贴此内容，请切换源码模式粘贴。"); }
              return true;
            },
            drop: (_view, event) => { event.preventDefault(); return true; },
            click: (_view, event) => { if ((event.target as Element)?.closest("a")) { event.preventDefault(); return true; } return false; },
          },

        },
        onUpdate: () => {
          if (!editor || syncing) return;
          // A concurrent source update during IME wins over a stale rendered transaction.
          if (!editable() || (pendingExternal && file.model.getValue() !== original)) { acceptExternal(); return; }
          try {
            const next = adapter.serialize(editor.getJSON(), editor.markdown!);
            if (next === original) return;
            const change = markdownChange(file.model.getValue(), next);
            const from = file.model.getPositionAt(change.start), to = file.model.getPositionAt(change.oldEnd);
            ownChange = true;
            try { file.model.pushEditOperations([], [{ range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text: change.text }], () => null); original = file.model.getValue(); }
            finally { ownChange = false; }
          } catch { failed = true; editor.setEditable(false); setError("无法安全更新 Markdown，请切换源码编辑；原有内容已保留。"); }
        },
        onSelectionUpdate: () => refresh(value => value + 1),
      });
      editor.registerPlugin(fenceLanguageCompletion(editable, () => file.model.pushStackElement()), (plugin, plugins) => [plugin, ...plugins]);
      editor.view.setProps({ nodeViews: { ...editor.extensionManager.nodeViews, codeBlock: codeNodeView } });
      instance.current = editor;
      syncing = true;
      editor.commands.setContent(adapter.parse(original, editor.markdown!, node => editor!.schema.nodeFromJSON(node).toJSON()), { emitUpdate: false });
      editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)));
      if (scroller.current) scroller.current.scrollTop = 0;
      syncing = false;
      const undo = (redo = false) => { file.model.pushStackElement(); if (redo) file.model.redo(); else file.model.undo(); };
      handle = {
        documentId, focus: () => editor?.commands.focus(undefined, { scrollIntoView: false }),
        setReadOnly: value => { allowed.current = !value; editor?.setEditable(editable()); for (const render of refreshDiagrams.current) render(); },
        execute(id) {
          if (!editor) return false;
          if (["actions.find", "editor.action.startFindReplaceAction", "editor.action.gotoLine", "editorRevealSource"].includes(id)) { callbacks.current.onSourceCommand(id); return true; }
          if (!editable()) return false;
          if (id === "undo" || id === "redo") { undo(id === "redo"); return true; }
          if (id === "editor.action.selectAll") { editor.commands.selectAll(); return true; }
          return false;
        },
      };
      const key = (event: KeyboardEvent) => {
        if (event.defaultPrevented || (event.target instanceof Element && event.target.closest(".editor-rich-code__toolbar")) || event.isComposing || editor!.view.composing || !editable()) return;
        if ((event.metaKey || event.ctrlKey) && !event.altKey && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopImmediatePropagation(); undo(event.key.toLowerCase() === "y" || event.shiftKey);
        }
      };
      element.addEventListener("keydown", key, true); element.addEventListener("compositionend", endComposition);
      callbacks.current.onMount(handle); refresh(value => value + 1);
      const unsubscribe = registry.subscribe(acceptExternal);
      return () => {
        unsubscribe(); element.removeEventListener("keydown", key, true); element.removeEventListener("compositionend", endComposition);
        if (registry.get(documentId)) file.model.pushStackElement(); if (handle) callbacks.current.onUnmount(handle);
        editor?.destroy(); instance.current = null; registry.releaseView(documentId, viewId);
      };
    } catch {
      editor?.destroy(); instance.current = null; registry.releaseView(documentId, viewId);
      setError("此文档暂时无法在所见即所得模式打开，原文已保留。");
    }
  }, [registry, documentId, viewId]);
  useEffect(() => { if (readOnly) dialogs.cancel(); instance.current?.setEditable(!readOnly); for (const render of refreshDiagrams.current) render(); }, [readOnly, registry, documentId]);
  async function editLink() {
    const editor = instance.current, file = registry.get(documentId); if (!editor || !file || !allowed.current) return;
    const revision = file.revision;
    const href = await dialogs.path("编辑链接地址", String(editor.getAttributes("link").href ?? "https://"));
    if (!href || !allowed.current || registry.get(documentId)?.revision !== revision) return;
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href)) { setNotice("链接仅支持 HTTP、HTTPS、邮件或相对路径，请检查地址。"); return; }
    file.model.pushStackElement();
    if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    file.model.pushStackElement();
  }
  function formatItems(): EditorMenuItem[] {
    const editor = instance.current;
    const command = (run: (editor: Editor) => void) => () => { if (editor && allowed.current) { registry.get(documentId)?.model.pushStackElement(); run(editor); registry.get(documentId)?.model.pushStackElement(); } };
    return [
      ...[1, 2, 3, 4, 5, 6].map(level => ({ id: `h${level}`, label: `标题 ${level}`, run: command(editor => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()) })),
      { id: "paragraph", label: "正文", run: command(editor => editor.chain().focus().setParagraph().run()) },
      { id: "bold", section: "行内格式", label: "粗体", run: command(editor => editor.chain().focus().toggleBold().run()) },
      { id: "italic", label: "斜体", run: command(editor => editor.chain().focus().toggleItalic().run()) },
      { id: "strike", label: "删除线", run: command(editor => editor.chain().focus().toggleStrike().run()) },
      { id: "code", label: "行内代码", run: command(editor => editor.chain().focus().toggleCode().run()) },
      { id: "link", section: "链接", label: "编辑链接", run: () => { void editLink(); } },
      { id: "unlink", label: "移除链接", disabled: !editor?.isActive("link"), run: command(editor => editor.chain().focus().unsetLink().run()) },
      { id: "bullet", section: "区块", label: "无序列表", run: command(editor => editor.chain().focus().toggleBulletList().run()) },
      { id: "ordered", label: "有序列表", run: command(editor => editor.chain().focus().toggleOrderedList().run()) },
      { id: "task", label: "任务列表", run: command(editor => editor.chain().focus().toggleTaskList().run()) },
      { id: "quote", label: "引用", run: command(editor => editor.chain().focus().toggleBlockquote().run()) },
      { id: "codeBlock", label: "代码块", run: command(editor => editor.chain().focus().toggleCodeBlock().run()) },
      { id: "mermaid", label: "Mermaid 图", run: command(editor => editor.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart LR\n  A[开始] --> B[完成]" }] }).run()) },
    ];
  }
  function tableItems(): EditorMenuItem[] {
    const editor = instance.current, inside = editor?.isActive("table");
    return [
      { id: "insert", label: "插入表格", disabled: !!inside, run: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: "row", label: "在下方插入行", disabled: !inside, run: () => editor?.chain().focus().addRowAfter().run() },
      { id: "column", label: "在右侧插入列", disabled: !inside, run: () => editor?.chain().focus().addColumnAfter().run() },
      { id: "removeRow", label: "删除行", disabled: !inside, run: () => editor?.chain().focus().deleteRow().run() },
      { id: "removeColumn", label: "删除列", disabled: !inside, run: () => editor?.chain().focus().deleteColumn().run() },
      { id: "remove", label: "删除表格", disabled: !inside, run: () => editor?.chain().focus().deleteTable().run() },
    ];
  }
  return <div className="editor-rich-view">
    {toolbarContainer ? createPortal(<div className="editor-rich-actions" role="toolbar" aria-label="Markdown 排版"><EditorActionMenu label="格式" disabled={readOnly || !!error} items={formatItems} /><EditorActionMenu label="表格" disabled={readOnly || !!error} items={tableItems} /></div>, toolbarContainer) : null}
    {notice ? <div className="editor-rich-notice" role="alert">{notice}<Button variant="ghost" onClick={() => setNotice(null)}>关闭提示</Button></div> : null}
    {error ? <div className="editor-rich-notice" role="alert">{error}<Button onClick={onSource}>使用源码编辑</Button></div> : null}
    <div ref={scroller} className="editor-rich-scroll"><div ref={host} className="editor-rich-host" /></div>
    {dialogs.dialog}
  </div>;
}
