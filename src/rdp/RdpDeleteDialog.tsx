import { useState } from "react";
import type { RdpProfile } from "../models/rdp";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../ui/useDialogFocus";
export function RdpDeleteDialog({ profile, onClose, onDelete }: { profile: RdpProfile; onClose: () => void; onDelete: () => Promise<void> }) {
  const dialogRef = useDialogFocus();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div className="profile-editor-backdrop" role="presentation"><section ref={dialogRef} className="profile-editor is-glass-overlay rdp-editor" role="dialog" aria-modal="true" aria-label="删除 RDP 连接" onKeyDown={(event) => { if (event.key === "Escape" && !busy && !event.defaultPrevented) onClose(); }}>
    <header className="profile-editor__topbar"><h2>删除 RDP 连接</h2></header><div className="rdp-editor__form">
      <div className="rdp-editor__body">
      <p>删除「{profile.name}」及其保存的密码？已打开的桌面将保持运行，仍可在会话列表断开。</p>
      {error ? <div className="form-errors" role="alert">{error}</div> : null}
      </div>
      <footer className="rdp-editor__actions"><Button autoFocus disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="danger" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } catch (e) { setError(e instanceof Error ? e.message : "删除失败。"); } finally { setBusy(false); } }}>{busy ? "正在删除…" : "删除连接"}</Button></footer>
    </div></section></div>;
}
