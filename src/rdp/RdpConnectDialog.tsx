import { useState, type FormEvent } from "react";
import type { RdpProfile } from "../models/rdp";
import { Button } from "../ui/Button";
import { useDialogFocus } from "./useDialogFocus";

export function RdpConnectDialog({ profile, onClose, onConnect }: { profile: RdpProfile; onClose: () => void; onConnect: (password: string) => Promise<void> }) {
  const dialogRef = useDialogFocus();
  const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try { await onConnect(password); setPassword(""); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "连接失败。"); }
    finally { setBusy(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation"><section ref={dialogRef} className="profile-editor is-glass-overlay rdp-editor" role="dialog" aria-modal="true" aria-label="连接远程桌面"
    onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
    <header className="profile-editor__topbar"><h2>连接 {profile.name}</h2></header>
    <form className="rdp-editor__form" onSubmit={submit}>
      <p className="profile-form__hint">{profile.username}@{profile.host}:{profile.port} · 本次密码仅用于连接，不保存。</p>
      {error ? <div className="form-errors" role="alert">{error}</div> : null}
      <label className="field"><span>Windows 密码</span><input autoFocus required type="password" autoComplete="off" value={password} maxLength={4096} onChange={(e) => setPassword(e.target.value)} /></label>
      <footer className="rdp-editor__actions"><Button onClick={onClose} disabled={busy}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "正在启动…" : "打开桌面"}</Button></footer>
    </form>
  </section></div>;
}
