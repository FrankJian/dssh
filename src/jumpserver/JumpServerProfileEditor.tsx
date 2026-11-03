import { useEffect, useState, type FormEvent } from "react";
import type { JumpServerAuthKind, JumpServerProfile } from "../models/jumpserver";
import { saveJumpServerProfile } from "../services/jumpserverService";
import type { SshProfile } from "../models";
import { listSshProfiles } from "../services/sshProfileService";
import { SelectMenu } from "../ui/SelectMenu";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useDialogFocus } from "../rdp/useDialogFocus";

export function JumpServerProfileEditor({ profile, clone = false, onClose, onSaved }: {
  profile: JumpServerProfile | null; clone?: boolean; onClose: () => void; onSaved: (profile: JumpServerProfile) => Promise<void> | void;
}) {
  const ref = useDialogFocus();
  const [name, setName] = useState(profile ? (clone ? `${profile.name} 克隆` : profile.name) : "");
  const [coreUrl, setCoreUrl] = useState(profile?.coreUrl ?? "");
  const [authKind, setAuthKind] = useState<JumpServerAuthKind>(profile?.authKind ?? (profile ? "accessKey" : "password"));
  const [username, setUsername] = useState(profile?.username ?? "");
  const [sshProfileId, setSshProfileId] = useState(profile?.sshProfileId ?? "");
  const [sshProfiles, setSshProfiles] = useState<SshProfile[]>([]);
  const [sshError, setSshError] = useState("");
  useEffect(() => {
    let live = true;
    void listSshProfiles().then((list) => { if (live) setSshProfiles(list); }).catch(() => { if (live) setSshError("无法读取现有 SSH 连接，可稍后编辑关联。"); });
    return () => { live = false; };
  }, []);
  const [keyId, setKeyId] = useState(profile?.keyId ?? "");
  const [orgId, setOrgId] = useState(profile?.orgId ?? "00000000-0000-0000-0000-000000000002");
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(profile?.hasCredential ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const originalAuth = profile?.authKind ?? "accessKey";
  const canKeepCredential = profile?.hasCredential && authKind === originalAuth && coreUrl.trim().replace(/\/$/, "") === profile.coreUrl.replace(/\/$/, "")
    && (authKind === "password" ? username === profile.username : keyId === profile.keyId);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const saved = await saveJumpServerProfile({ id: clone ? undefined : profile?.id, cloneSourceId: clone ? profile?.id : undefined, name, coreUrl, keyId: authKind === "accessKey" ? keyId : "", authKind, username: authKind === "password" ? username : "", sshProfileId: sshProfileId || null, orgId, secret: secret || undefined, rememberSecret: remember });
      setSecret(""); await onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation">
    <section ref={ref} className="profile-editor is-glass-overlay rdp-editor" role="dialog" aria-modal="true" aria-label={profile && !clone ? "编辑 JumpServer 连接" : "新建 JumpServer 连接"}
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
      <header className="profile-editor__topbar"><h2>{profile && !clone ? "编辑" : "新建"} JumpServer 连接</h2><button className="icon-button" type="button" disabled={busy} aria-label="关闭编辑器" onClick={onClose}><Icon name="close" /></button></header>
      <form className="rdp-editor__form" onSubmit={submit}>
        {error && <p className="form-errors" role="alert">{error}</p>}
        <p className="profile-form__hint">使用用户名、密码与 OTP 登录资产目录，也可选择 Access Key。资产连接继续经过 KoKo。</p>
        <label className="field"><span>连接名称</span><input autoFocus required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Core HTTPS 地址</span><input required type="url" spellCheck={false} placeholder="https://jumpserver.example.com" value={coreUrl} onChange={(e) => setCoreUrl(e.target.value)} /><small className="profile-form__hint">填写站点根地址。KoKo 的 SSH 端点会从连接描述读取。</small></label>
        <label className="field"><span>认证方式</span><SelectMenu ariaLabel="JumpServer 认证方式" value={authKind} disabled={busy}
          options={[{ value: "password", label: "用户名和密码（支持 OTP）" }, { value: "accessKey", label: "Access Key" }]}
          onChange={(value) => { setAuthKind(value as JumpServerAuthKind); setSecret(""); setRemember(false); }} /></label>
        {authKind === "password" ? <label className="field"><span>JumpServer 用户名</span><input required autoComplete="username" maxLength={256} value={username} onChange={(e) => setUsername(e.target.value)} /></label> :
          <label className="field"><span>Access Key ID</span><input required autoComplete="off" spellCheck={false} maxLength={128} value={keyId} onChange={(e) => setKeyId(e.target.value)} /></label>}
        <label className="field"><span>{authKind === "password" ? "密码" : "Access Key Secret"}{canKeepCredential ? "（已保存，留空保留）" : "（可在登录时输入）"}</span><input required={remember && !canKeepCredential} type="password" autoComplete="new-password" maxLength={4096} value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />保存{authKind === "password" ? "密码" : "Secret"}到系统凭据库</label>
        {authKind === "password" && <p className="profile-form__hint">OTP 在服务端要求时单独输入，不保存验证码或 OTP 密钥。Core 的登录策略可能与 SSH 不同。</p>}
        <label className="field"><span>关联现有 SSH 连接（可选）</span><SelectMenu ariaLabel="关联现有 SSH 连接" value={sshProfileId} options={[
          { value: "", label: "不关联" }, ...sshProfiles.map((p) => ({ value: p.id, label: `${p.name} · ${p.username}@${p.host}:${p.port}` })),
          ...(sshProfileId && !sshProfiles.some((p) => p.id === sshProfileId) ? [{ value: sshProfileId, label: "原 SSH 连接不可用", disabled: true }] : []),
        ]} onChange={setSshProfileId} />
          <small className="profile-form__hint">可继续使用你原来的 SSH 密码 + OTP 登录。该入口打开原交互终端，不会自动获取资产目录。</small>
          {sshError && <small className="profile-form__hint">{sshError}</small>}
        </label>
        <label className="field"><span>组织 ID</span><input required spellCheck={false} maxLength={128} value={orgId} onChange={(e) => setOrgId(e.target.value)} /><small className="profile-form__hint">默认为 Default 组织；其他组织请填写其准确 ID。此配置的目录和连接均限定到该组织。</small></label>
        <p className="profile-form__hint">SSO、人工账号、登录复核或非 OTP 额外验证暂需使用官方 Web。HTTPS 证书必须可信，支持系统信任的私有 CA。</p>
        <footer className="rdp-editor__actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "保存中…" : "保存连接"}</Button></footer>
      </form>
    </section>
  </div>;
}
