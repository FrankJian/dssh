import { useEffect, useState, type FormEvent } from "react";
import type { AppLockStatus, UpdateAppLockSettingsRequest } from "../services/appLockService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface AppLockSettingsProps {
  status: AppLockStatus | null;
  onSave: (request: UpdateAppLockSettingsRequest) => Promise<void>;
}

const DEFAULT_TIMEOUT = 15;

type PasswordDialogMode = "change" | "disable";

interface AppLockPasswordDialogProps {
  busy: boolean;
  mode: PasswordDialogMode;
  onCancel: () => void;
  onSubmit: (currentPassword: string, newPassword?: string) => Promise<void>;
}

function AppLockPasswordDialog({ busy, mode, onCancel, onSubmit }: AppLockPasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const changingPassword = mode === "change";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword) {
      setError("请输入当前锁屏密码。");
      return;
    }
    if (changingPassword && !newPassword) {
      setError("请输入新锁屏密码。");
      return;
    }
    if (changingPassword && newPassword !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setError(null);
    try {
      await onSubmit(currentPassword, changingPassword ? newPassword : undefined);
      onCancel();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "无法保存锁屏设置。");
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section
        aria-label={changingPassword ? "修改锁屏密码" : "关闭锁屏"}
        aria-modal="true"
        className="config-password"
        role="dialog"
      >
        <header className="config-password__header">
          <h3>{changingPassword ? "修改锁屏密码" : "确认关闭锁屏"}</h3>
          <button aria-label="关闭" className="icon-button" disabled={busy} onClick={onCancel} type="button">
            <Icon name="close" height="16" width="16" />
          </button>
        </header>
        <p className="config-password__hint">
          {changingPassword ? "请输入当前密码并设置新密码。新密码至少需要 6 个字符。" : "请输入当前锁屏密码以关闭锁屏。"}
        </p>
        <form className="config-password__form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span>当前密码</span>
            <input
              autoComplete="current-password"
              autoFocus
              disabled={busy}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              type="password"
              value={currentPassword}
            />
          </label>
          {changingPassword ? (
            <>
              <label className="field">
                <span>新密码</span>
                <input
                  autoComplete="new-password"
                  disabled={busy}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  type="password"
                  value={newPassword}
                />
              </label>
              <label className="field">
                <span>确认新密码</span>
                <input
                  autoComplete="new-password"
                  disabled={busy}
                  onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                  type="password"
                  value={confirmPassword}
                />
              </label>
            </>
          ) : null}
          {error ? <div className="config-password__error" role="alert">{error}</div> : null}
          <div className="config-password__actions">
            <Button disabled={busy} onClick={onCancel} variant="ghost">取消</Button>
            <Button disabled={busy} type="submit" variant="primary">
              {busy ? "保存中…" : changingPassword ? "保存新密码" : "关闭锁屏"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function AppLockSettings({ status, onSave }: AppLockSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [autoLockEnabled, setAutoLockEnabled] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialogMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    setEnabled(status.settings.enabled);
    setAutoLockEnabled(status.settings.autoLockEnabled);
    setTimeoutMinutes(status.settings.timeoutMinutes);
  }, [status]);

  const disabling = status?.settings.enabled && !enabled;

  async function save() {
    setError(null);
    setMessage(null);
    if (disabling) {
      setPasswordDialog("disable");
      return;
    }
    if (enabled && !status?.settings.hasPassword && !newPassword) {
      setError("开启锁屏前，请设置锁屏密码。");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        enabled,
        autoLockEnabled,
        timeoutMinutes,
        newPassword: newPassword || undefined,
      });
      setNewPassword("");
      setConfirmPassword("");
      setMessage("锁屏设置已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "无法保存锁屏设置。");
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordDialog(currentPassword: string, nextPassword?: string) {
    if (!passwordDialog) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await onSave({
        enabled: passwordDialog === "disable" ? false : enabled,
        autoLockEnabled: passwordDialog === "disable" ? false : autoLockEnabled,
        timeoutMinutes,
        currentPassword,
        newPassword: nextPassword,
      });
      setMessage(passwordDialog === "change" ? "锁屏密码已修改。" : "锁屏已关闭。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-label="安全与锁屏">
      <div className="settings-section__head">
        <h3>锁屏</h3>
        <p>锁屏会遮挡当前窗口和独立工作区；密码仅以安全哈希形式保存在本机。</p>
      </div>
      {!status ? <p className="settings-card__hint">正在读取锁屏设置…</p> : (
        <>
          <div className="settings-card settings-card--fields">
            <label className="checkbox-field">
              <input checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.currentTarget.checked)} type="checkbox" />
              启用锁屏
            </label>
            <label className="checkbox-field">
              <input
                checked={autoLockEnabled}
                disabled={busy || !enabled}
                onChange={(event) => setAutoLockEnabled(event.currentTarget.checked)}
                type="checkbox"
              />
              无操作时自动锁屏
            </label>
            <label className="settings-field">
              <span className="settings-field__label">自动锁屏时间（分钟）</span>
              <input
                className="settings-number"
                disabled={busy || !enabled || !autoLockEnabled}
                max={240}
                min={1}
                onChange={(event) => setTimeoutMinutes(Number(event.currentTarget.value))}
                type="number"
                value={timeoutMinutes}
              />
            </label>
          </div>

          {status.settings.hasPassword ? (
            <div className="settings-section__head">
              <h3>锁屏密码</h3>
              <p>修改密码或关闭锁屏时，需要验证当前密码。</p>
              <div className="settings-config__actions">
                <Button disabled={busy} onClick={() => setPasswordDialog("change")} variant="secondary">修改锁屏密码</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="settings-section__head">
                <h3>设置锁屏密码</h3>
                <p>密码至少需要 6 个字符。</p>
              </div>
              <div className="form-grid">
                <label className="settings-field">
                  <span className="settings-field__label">锁屏密码</span>
                  <input
                    autoComplete="new-password"
                    disabled={busy || !enabled}
                    onChange={(event) => setNewPassword(event.currentTarget.value)}
                    type="password"
                    value={newPassword}
                  />
                </label>
                <label className="settings-field">
                  <span className="settings-field__label">确认密码</span>
                  <input
                    autoComplete="new-password"
                    disabled={busy || !enabled}
                    onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                    type="password"
                    value={confirmPassword}
                  />
                </label>
              </div>
            </>
          )}
          {error ? <div className="settings-config__error" role="alert">{error}</div> : null}
          {message ? <div className="settings-config__message">{message}</div> : null}
          <div className="settings-config__actions">
            <Button disabled={busy} onClick={() => void save()} variant="primary">保存锁屏设置</Button>
          </div>
          {passwordDialog ? (
            <AppLockPasswordDialog
              busy={busy}
              mode={passwordDialog}
              onCancel={() => setPasswordDialog(null)}
              onSubmit={submitPasswordDialog}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
