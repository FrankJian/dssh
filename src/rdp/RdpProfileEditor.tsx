import { useState, type FormEvent } from "react";
import { emptyRdpProfile, type PasswordUpdate, type RdpEngineStatus, type RdpProfile } from "../models/rdp";
import { saveRdpProfile } from "../services/rdpService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";
import { TagInput } from "../ssh/TagInput";
import { useDialogFocus } from "./useDialogFocus";

const RESOLUTION_PRESETS = [
  { value: "720p", label: "720P · 1280 × 720", width: 1280, height: 720 },
  { value: "laptop", label: "1366 × 768", width: 1366, height: 768 },
  { value: "1080p", label: "1080P · 1920 × 1080", width: 1920, height: 1080 },
  { value: "2k", label: "2K / QHD · 2560 × 1440", width: 2560, height: 1440 },
  { value: "4k", label: "4K / UHD · 3840 × 2160", width: 3840, height: 2160 },
];

interface Props { profile: RdpProfile | null; initialTags?: string[]; allTags: string[]; engine: RdpEngineStatus | null; onClose: () => void; onSaved: () => Promise<void> }
export function RdpProfileEditor({ profile, initialTags, allTags, engine, onClose, onSaved }: Props) {
  const dialogRef = useDialogFocus();
  const [draft, setDraft] = useState<RdpProfile>(() => profile ? { ...profile } : { ...emptyRdpProfile(), tags: initialTags ?? [] });
  const [resolution, setResolution] = useState(() =>
    RESOLUTION_PRESETS.find((preset) => preset.width === draft.width && preset.height === draft.height)?.value ?? "custom");
  const [password, setPassword] = useState("");
  const [passwordAction, setPasswordAction] = useState<PasswordUpdate["action"]>("keep");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function field<K extends keyof RdpProfile>(key: K, value: RdpProfile[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await saveRdpProfile(draft, passwordAction === "replace" ? { action: "replace", value: password } : { action: passwordAction });
      setPassword(""); await onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation">
    <section ref={dialogRef} className="profile-editor is-glass-overlay rdp-editor" role="dialog" aria-modal="true" aria-label={profile ? "编辑 RDP 连接" : "新建 RDP 连接"}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <header className="profile-editor__topbar"><h2>{profile ? "编辑" : "新建"} RDP 连接</h2>
        <button className="icon-button" type="button" aria-label="关闭编辑器" disabled={busy} onClick={onClose}><Icon name="close" /></button></header>
      <form className="rdp-editor__form" onSubmit={submit}>
        {error ? <div className="form-errors" role="alert">{error}</div> : null}
        <p className="profile-form__hint">独立原生桌面窗口 · Windows Pro / Enterprise / Server · NLA。首版仅直连，剪贴板与设备重定向关闭；暂不参与 YAML 导入导出。</p>
        {engine && !engine.available ? <p className="profile-form__hint" role="status">{engine.message}</p> : null}
        <label className="field"><span>名称</span><input autoFocus required maxLength={160} value={draft.name} onChange={(e) => field("name", e.target.value)} /></label>
        <div className="rdp-editor__row">
          <label className="field"><span>Windows 主机</span><input required spellCheck={false} placeholder="192.168.1.10" value={draft.host} onChange={(e) => field("host", e.target.value)} /></label>
          <label className="field"><span>端口</span><input required type="number" min={1} max={65535} value={draft.port} onChange={(e) => field("port", Number(e.target.value))} /></label>
        </div>
        <div className="rdp-editor__row">
          <label className="field"><span>用户名</span><input required autoComplete="off" value={draft.username} onChange={(e) => field("username", e.target.value)} /></label>
          <label className="field"><span>域（可选）</span><input placeholder="DOMAIN 或计算机名" value={draft.domain} onChange={(e) => field("domain", e.target.value)} /></label>
        </div>
        <div className="field"><span>保存的密码{profile?.hasPassword ? "（已保存在系统凭据库）" : ""}</span>
          <SelectMenu ariaLabel="密码更新方式" value={passwordAction} onChange={(v) => { setPasswordAction(v as PasswordUpdate["action"]); setPassword(""); }}
            options={[{ value: "keep", label: profile?.hasPassword ? "保留现有密码" : "不保存，连接时输入" }, { value: "replace", label: "保存新密码到系统凭据库" }, { value: "clear", label: "清除保存的密码" }]} />
        </div>
        {passwordAction === "replace" ? <label className="field"><span>新密码</span><input required type="password" autoComplete="new-password" maxLength={4096} value={password} onChange={(e) => setPassword(e.target.value)} /></label> : null}
        <label className="checkbox-field"><input type="checkbox" checked={draft.skipCertificateVerification}
          aria-describedby="rdp-certificate-policy" onChange={(e) => field("skipCertificateVerification", e.target.checked)} />跳过服务器证书验证（不安全）</label>
        <p id="rdp-certificate-policy" className={draft.skipCertificateVerification ? "rdp-security-warning" : "profile-form__hint"}>
          {draft.skipCertificateVerification ? "已关闭证书链、主机名及指纹校验，无法确认服务器身份，可能遭遇中间人攻击。仅用于你信任的网络；连接仍使用加密和 NLA 认证。" : "默认验证服务器证书。内网自签名证书或名称不匹配时，可按需为此连接开启跳过验证。"}
        </p>
        <label className="field"><span>服务器证书 SHA-256 指纹（可选）</span>
          <input disabled={draft.skipCertificateVerification} spellCheck={false} maxLength={95} value={draft.certificateFingerprint} onChange={(e) => field("certificateFingerprint", e.target.value)} />
          <small className="profile-form__hint">{draft.skipCertificateVerification ? "已保存的指纹暂不使用，关闭跳过验证后恢复生效。" : "留空校验证书链和主机名。自签名证书请先通过可信渠道核对完整指纹；更改此字段即更改信任的服务器证书。"}</small>
        </label>
        <div className="field"><span>桌面分辨率</span>
          <SelectMenu ariaLabel="桌面分辨率" value={resolution}
            options={[...RESOLUTION_PRESETS, { value: "custom", label: "自定义" }]}
            onChange={(value) => {
              setResolution(value);
              const preset = RESOLUTION_PRESETS.find((item) => item.value === value);
              if (preset) setDraft((current) => ({ ...current, width: preset.width, height: preset.height }));
            }} />
          <small className="profile-form__hint">保存后，下次连接生效。</small>
        </div>
        {resolution === "custom" ? <div className="rdp-editor__row">
          <label className="field"><span>桌面宽度</span><input required type="number" min={640} max={7680} value={draft.width} onChange={(e) => field("width", Number(e.target.value))} /></label>
          <label className="field"><span>桌面高度</span><input required type="number" min={480} max={4320} value={draft.height} onChange={(e) => field("height", Number(e.target.value))} /></label>
        </div> : null}
        <div className="field"><span>标签</span><TagInput value={draft.tags} suggestions={allTags} onChange={(tags) => field("tags", tags)} /></div>
        <label className="field"><span>描述</span><input value={draft.description} onChange={(e) => field("description", e.target.value)} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={draft.favorite} onChange={(e) => field("favorite", e.target.checked)} />收藏此连接</label>
        <footer className="rdp-editor__actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "正在保存…" : "保存连接"}</Button></footer>
      </form>
    </section>
  </div>;
}
