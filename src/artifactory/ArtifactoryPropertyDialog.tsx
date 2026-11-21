import { useState, type FormEvent } from "react";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../ui/useDialogFocus";
import { useConfirmation } from "../ui/useConfirmation";

interface Props {
  itemName: string;
  initial?: { key: string; values: string[] };
  onClose: () => void;
  onSave: (key: string, values: string[]) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}

export function ArtifactoryPropertyDialog({ itemName, initial, onClose, onSave, onDelete }: Props) {
  const dialogRef = useDialogFocus<HTMLFormElement>();
  const [key, setKey] = useState(initial?.key ?? "");
  const [values, setValues] = useState(initial?.values.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const items = values.split("\n").map((value) => value.trim()).filter(Boolean);
    if (!key.trim() || !items.length) { setError("请填写属性名和至少一个属性值。"); return; }
    setBusy(true); setError(null);
    try { await onSave(key.trim(), items); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存属性失败。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !initial) return;
    if (!await requestConfirmation({ title: "删除属性？", message: `从“${itemName}”移除属性“${initial.key}”？只影响当前项。`, confirmLabel: "删除属性", destructive: true })) return;
    setBusy(true); setError(null);
    try { await onDelete(initial.key); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "删除属性失败。"); }
    finally { setBusy(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation"><form ref={dialogRef} aria-label={initial ? "编辑属性" : "添加属性"} aria-modal="true" className="profile-editor artifactory-property-dialog is-glass-overlay" onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !busy) { event.stopPropagation(); onClose(); } }} onSubmit={(event) => void submit(event)} role="dialog">
    <header className="artifactory-property-dialog__header"><div><h2>{initial ? "编辑属性" : "添加属性"}</h2><p title={itemName}>{itemName}</p></div><Button aria-label="关闭属性编辑" disabled={busy} onClick={onClose} variant="ghost"><Icon name="close" /></Button></header>
    <div className="artifactory-property-dialog__body"><label>属性名<input autoFocus disabled={Boolean(initial) || busy} maxLength={255} onChange={(event) => setKey(event.target.value)} placeholder="例如：release.status" required value={key} /></label><label>属性值<textarea disabled={busy} onChange={(event) => setValues(event.target.value)} placeholder="每行一个值" required rows={4} value={values} /></label><p>仅修改当前文件或目录，不递归应用。</p>{error && <p className="artifactory-property-dialog__error" role="alert">{error}</p>}</div>
    <footer className="profile-editor__footer artifactory-property-dialog__footer">{initial ? <Button className="artifactory-property-dialog__delete" disabled={busy} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); void remove(); }} variant="ghost">删除属性</Button> : <span />}<div><Button disabled={busy} onClick={onClose} variant="ghost">取消</Button><Button disabled={busy} type="submit" variant="primary">{busy ? "保存中…" : "保存属性"}</Button></div></footer>
    {confirmationDialog}
  </form></div>;
}
