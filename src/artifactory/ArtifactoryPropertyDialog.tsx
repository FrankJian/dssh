import { useState, type FormEvent } from "react";
import { Icon } from "../ui/Icon";

interface Props {
  itemName: string;
  initial?: { key: string; values: string[] };
  onClose: () => void;
  onSave: (key: string, values: string[]) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}

export function ArtifactoryPropertyDialog({ itemName, initial, onClose, onSave, onDelete }: Props) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [values, setValues] = useState(initial?.values.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const items = values.split("\n").map((value) => value.trim()).filter(Boolean);
    if (!key.trim() || !items.length) { setError("请填写属性名和至少一个属性值。"); return; }
    setBusy(true); setError(null);
    try { await onSave(key.trim(), items); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存属性失败。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!initial || !window.confirm(`从“${itemName}”移除属性“${initial.key}”？只影响当前项。`)) return;
    setBusy(true); setError(null);
    try { await onDelete(initial.key); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "删除属性失败。"); }
    finally { setBusy(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation"><form aria-label={initial ? "编辑属性" : "添加属性"} aria-modal="true" className="profile-editor artifactory-property-dialog is-glass-overlay" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} onSubmit={(event) => void submit(event)} role="dialog">
    <header className="artifactory-property-dialog__header"><div><h2>{initial ? "编辑属性" : "添加属性"}</h2><p title={itemName}>{itemName}</p></div><button aria-label="关闭属性编辑" onClick={onClose} type="button"><Icon name="close" /></button></header>
    <div className="artifactory-property-dialog__body"><label>属性名<input autoFocus disabled={Boolean(initial)} maxLength={255} onChange={(event) => setKey(event.target.value)} placeholder="例如：release.status" required value={key} /></label><label>属性值<textarea onChange={(event) => setValues(event.target.value)} placeholder="每行一个值" required rows={4} value={values} /></label><p>每行一个值。仅修改当前文件或目录，不递归应用。</p>{error && <p className="artifactory-property-dialog__error" role="alert">{error}</p>}</div>
    <footer className="profile-editor__footer artifactory-property-dialog__footer">{initial ? <button className="button artifactory-property-dialog__delete" disabled={busy} onClick={() => void remove()} type="button">删除属性</button> : <span />}<div><button className="button button--ghost" disabled={busy} onClick={onClose} type="button">取消</button><button className="button button--primary" disabled={busy} type="submit">{busy ? "保存中…" : "保存属性"}</button></div></footer>
  </form></div>;
}
