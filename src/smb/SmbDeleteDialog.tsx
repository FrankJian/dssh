import { useState } from "react";
import type { SmbProfile } from "../models/smb";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../rdp/useDialogFocus";

export function SmbDeleteDialog({ profile, onClose, onDelete }: { profile: SmbProfile; onClose: () => void; onDelete: () => Promise<void> }) {
  const dialogRef = useDialogFocus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="profile-editor-backdrop" role="presentation">
    <section ref={dialogRef} className="profile-editor is-glass-overlay rdp-editor" role="dialog" aria-modal="true" aria-label="删除网络共享配置"
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <header className="profile-editor__topbar"><h2>删除网络共享配置</h2></header>
      <div className="rdp-editor__form">
        <p>删除「{profile.name}」？已建立的 Windows 盘符映射不会自动断开。</p>
        {error ? <div className="form-errors" role="alert">{error}</div> : null}
        <footer className="rdp-editor__actions"><Button autoFocus disabled={busy} onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(); } catch (e) { setError(e instanceof Error ? e.message : "删除失败。"); } finally { setBusy(false); } }}>{busy ? "正在删除…" : "删除连接"}</Button></footer>
      </div>
    </section>
  </div>;
}
