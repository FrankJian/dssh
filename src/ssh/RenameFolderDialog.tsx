import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDialogFocus } from "../rdp/useDialogFocus";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { renamedConnectionFolderPath } from "./connectionFolders";

export function RenameFolderDialog({ path, count, onRename, onClose }: {
  path: string; count: number; onRename: (name: string) => Promise<void>; onClose: () => void;
}) {
  const dialogRef = useDialogFocus();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(path.slice(path.lastIndexOf("/") + 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  let target = "";
  let validation = "";
  try { target = renamedConnectionFolderPath(path, name); } catch (reason) { validation = (reason as Error).message; }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || validation || target === path) return;
    setSaving(true); setError("");
    try { await onRename(name.trim()); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "重命名目录失败。"); setSaving(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation">
    <section className="ssh-delete-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="重命名目录"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); if (!saving) onClose(); }
        if (saving && event.key === "Tab") event.preventDefault();
      }}>
      <header className="profile-editor__topbar"><h2>重命名目录</h2>
        <button type="button" className="icon-button" aria-label="关闭" disabled={saving} onClick={onClose}><Icon name="close" /></button>
      </header>
      <form className="ssh-delete-dialog__body" onSubmit={(event) => void submit(event)}>
        <p>将更新“{path}”及其子目录下 {count} 个连接的目录路径。</p>
        <label className="field"><span>目录名称</span>
          <input ref={inputRef} aria-label="目录名称" value={name} disabled={saving} onChange={(event) => { setName(event.target.value); setError(""); }} />
        </label>
        {target ? <p>新路径：{target}</p> : null}
        {validation || error ? <div className="form-errors" role="alert">{validation || error}</div> : null}
        <footer className="s3-dialog-actions"><Button disabled={saving} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={saving || Boolean(validation) || target === path}>{saving ? "保存中…" : "保存"}</Button>
        </footer>
      </form>
    </section>
  </div>;
}
