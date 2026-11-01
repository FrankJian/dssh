import { useEffect, useRef, useState, type FormEvent } from "react";
import type { JumpServerIdentity, JumpServerProfile } from "../models/jumpserver";
import { cancelJumpServerLogin, loginJumpServer, logoutJumpServer, verifyJumpServerOtp } from "../services/jumpserverService";
import { Button } from "../ui/Button";

export function JumpServerLogin({ profile, onReady }: { profile: JumpServerProfile; onReady: (identity: JumpServerIdentity) => void }) {
  const [secret, setSecret] = useState("");
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const pending = useRef<string | null>(null);
  const passwordMode = profile.authKind === "password";
  useEffect(() => () => {
    attempt.current++;
    if (pending.current) void cancelJumpServerLogin(profile.id, pending.current).catch(() => undefined);
  }, [profile.id]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const current = ++attempt.current;
    setBusy(true); setError("");
    const supplied = secret; const code = otp; setSecret(""); setOtp("");
    try {
      const result = challenge ? await verifyJumpServerOtp(profile.id, challenge, code) : await loginJumpServer(profile.id, supplied);
      if (attempt.current !== current) {
        if (result.status === "otpRequired") void cancelJumpServerLogin(profile.id, result.challengeId).catch(() => undefined);
        return;
      }
      if (result.status === "ready") { pending.current = null; setChallenge(null); onReady(result.identity); }
      else { pending.current = result.challengeId; setChallenge(result.challengeId); }
    } catch (e) { if (attempt.current === current) setError(e instanceof Error ? e.message : "登录失败。"); }
    finally { if (attempt.current === current) setBusy(false); }
  }
  async function cancel() {
    attempt.current++; setBusy(true); setError("");
    try {
      // Invalidate even a response that completed just before the user cancelled.
      await logoutJumpServer(profile.id);
      pending.current = null; setChallenge(null); setSecret(""); setOtp("");
    } catch (e) { setError(e instanceof Error ? e.message : "取消登录失败。"); }
    finally { setBusy(false); }
  }
  return <form className="jumpserver__login" onSubmit={submit}>
    <h2>{challenge ? "验证 OTP" : "登录资产工作台"}</h2>
    <p>{challenge ? `已验证 ${profile.username} 的密码，请输入认证器当前的 OTP 验证码。` : passwordMode ? "使用 JumpServer 用户名和密码登录；服务端要求时，再输入 OTP。" : "使用 Access Key 查询当前用户的授权资产。"}</p>
    {error && <p className="jumpserver__error" role="alert">{error}</p>}
    {passwordMode && !challenge && <label className="field"><span>用户名</span><input readOnly autoComplete="username" value={profile.username} /></label>}
    {challenge ? <label className="field"><span>OTP 验证码</span><input autoFocus required type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value)} disabled={busy} /><small className="profile-form__hint">验证码仅用于本次验证，不会保存。验证会话最长保留 5 分钟。</small></label> :
      <label className="field"><span>{passwordMode ? "密码" : "Access Key Secret"}{profile.hasCredential ? "（留空使用系统凭据库）" : ""}</span><input type="password" autoComplete={passwordMode ? "current-password" : "off"} maxLength={4096} value={secret} onChange={(e) => setSecret(e.target.value)} disabled={busy} /></label>}
    <div className="jumpserver__actions"><Button type="submit" variant="primary" disabled={busy}>{busy ? "正在认证…" : challenge ? "验证并登录" : "登录并加载资产"}</Button>
      {(busy || challenge) && <Button onClick={() => void cancel()}>{challenge ? "重新登录" : "取消登录"}</Button>}
    </div>
    <p className="profile-form__hint">资产目录使用 Core API，认证策略可能与 SSH 不同。需要 SSO、审批或其他验证时，请使用关联的 SSH 连接或官方 Web。</p>
  </form>;
}
