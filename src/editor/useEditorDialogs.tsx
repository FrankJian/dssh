import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { FileEntryIcon } from "../sftp/FileEntryIcon";
import type { EditorQuestion } from "./editorActions";

type Prompt = { kind: "choice"; question: EditorQuestion } | { kind: "path"; title: string; initial: string };
export function useEditorDialogs(scopeLabel: string) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [value, setValue] = useState("");
  const pending = useRef<((value: string | null) => void) | null>(null);
  const settle = useCallback((answer: string | null) => {
    const resolve = pending.current; pending.current = null; setPrompt(null); resolve?.(answer);
  }, []);
  useEffect(() => () => { pending.current?.(null); pending.current = null; }, []);
  const choose = useCallback((question: EditorQuestion): Promise<string | null> => {
    if (pending.current) return Promise.resolve(null);
    return new Promise((resolve) => { pending.current = resolve; setPrompt({ kind: "choice", question }); });
  }, []);
  const path = useCallback((title: string, initial: string): Promise<string | null> => {
    if (pending.current) return Promise.resolve(null);
    setValue(initial);
    return new Promise((resolve) => { pending.current = resolve; setPrompt({ kind: "path", title, initial }); });
  }, []);
  const question = prompt?.kind === "choice" ? prompt.question : null;
  const saveChanges = question?.kind === "saveChanges";
  const filePath = question?.message ?? "";
  const separator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = filePath.slice(separator + 1);
  const directory = separator < 0 ? null : filePath.slice(0, separator) || "/";
  const dialog = !prompt ? null : <Dialog
    className={saveChanges ? "editor-save-dialog" : undefined}
    title={saveChanges ? question.title : `${prompt.kind === "choice" ? prompt.question.title : prompt.title} · ${scopeLabel}`}
    onClose={() => settle(null)} initialFocusSelector={prompt.kind === "path" ? "input" : "[data-cancel]"}
    footer={saveChanges ? <>
      {question.choices.filter(choice => choice.danger).map(choice => <Button key={choice.id} variant="ghost" className="editor-save-dialog__discard" onClick={() => settle(choice.id)}>{choice.label}</Button>)}
      <Button data-cancel variant="ghost" onClick={() => settle(null)}>取消</Button>
      {question.choices.filter(choice => !choice.danger).map(choice => <Button key={choice.id} variant="primary" onClick={() => settle(choice.id)}>{choice.label}</Button>)}
    </> : <>
      <Button data-cancel onClick={() => settle(null)}>取消</Button>
      {prompt.kind === "choice" ? prompt.question.choices.map((choice) => <Button key={choice.id} variant={choice.danger ? "danger" : "secondary"} onClick={() => settle(choice.id)}>{choice.label}</Button>)
        : <Button disabled={!value.trim()} variant="primary" onClick={() => settle(value)}>确定</Button>}
    </>}>
    {saveChanges ? <div className="editor-save-dialog__content">
      <div className="editor-save-dialog__file" role="group" aria-label="未保存的文件">
        <FileEntryIcon name={fileName} />
        <div><strong className="editor-save-dialog__name">{fileName}</strong>{directory ? <span className="editor-save-dialog__path" title={filePath}>{directory}</span> : null}</div>
      </div>
      <p className="editor-save-dialog__notice">关闭后，未保存的修改将丢失。</p>
    </div> : prompt.kind === "choice" ? <p className="editor-dialog-message">{prompt.question.message}</p> : <label className="editor-path-input">绝对路径
      <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && value.trim()) { event.preventDefault(); settle(value); } }} />
    </label>}
  </Dialog>;
  return { choose, path, dialog, cancel: () => settle(null), busy: prompt !== null };
}
