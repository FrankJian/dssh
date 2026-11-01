import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface RenameTagDialogProps {
  tag: string;
  count: number;
  allTags: string[];
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
}

export function RenameTagDialog({ tag, count, allTags, onRename, onClose }: RenameTagDialogProps) {
  const [name, setName] = useState(tag);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const merges = trimmedName !== tag && allTags.includes(trimmedName);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !trimmedName || trimmedName === tag) return;
    setSaving(true);
    setError(null);
    try {
      await onRename(trimmedName);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重命名标签失败，请重试。");
      setSaving(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="ssh-delete-dialog" role="dialog" aria-modal="true" aria-label="重命名标签"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!saving) onClose();
          }
          if (event.key === "Tab") {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <header className="profile-editor__topbar">
          <h2>重命名标签</h2>
          <button aria-label="关闭" className="icon-button" disabled={saving} onClick={onClose} type="button"><Icon name="close" /></button>
        </header>
        <form className="ssh-delete-dialog__body" onSubmit={(event) => void submit(event)}>
          <p>将统一修改 {count} 个连接中的“{tag}”标签。</p>
          <label className="field">
            <span>标签名称</span>
            <input autoFocus onFocus={(event) => event.currentTarget.select()} value={name} disabled={saving}
              onChange={(event) => setName(event.target.value)} aria-label="标签名称" />
          </label>
          {merges ? <p>“{trimmedName}”已存在，保存后将合并到该分组，并自动去除重复标签。</p> : null}
          {error ? <div className="form-errors" role="alert">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={saving} onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary" disabled={saving || !trimmedName || trimmedName === tag}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
