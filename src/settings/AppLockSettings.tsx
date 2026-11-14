import { SettingsSwitch } from "../ui/SettingsSwitch";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { AppLockStatus, UpdateAppLockSettingsRequest } from "../services/appLockService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface AppLockSettingsProps {
  status: AppLockStatus | null;
  onSave: (request: UpdateAppLockSettingsRequest) => Promise<void>;
}

const DEFAULT_TIMEOUT = 15;
const MIN_PASSWORD_LENGTH = 6;

interface PasswordFieldProps {
  label: string;
  value: string;
  disabled: boolean;
  describedBy: string;
  invalid?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

function PasswordField({ label, value, disabled, describedBy, invalid, onChange, onBlur }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div className="lock-password__row" onBlur={(event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setVisible(false);
      onBlur?.();
    }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoCapitalize="none"
        autoComplete="new-password"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        type={visible && !disabled ? "text" : "password"}
        value={value}
      />
      <Button
        aria-label={`${visible ? "隐藏" : "显示"}${label}`}
        className="lock-password__visibility"
        disabled={disabled || !value}
        onClick={(event) => {
          event.currentTarget.focus();
          setVisible((previous) => !previous);
        }}
        variant="ghost"
      >
        {visible && !disabled ? "隐藏" : "显示"}
      </Button>
    </div>
  );
}

interface PasswordPairProps {
  password: string;
  confirmation: string;
  disabled: boolean;
  changing?: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
}

function PasswordPair({ password, confirmation, disabled, changing, onPasswordChange, onConfirmationChange }: PasswordPairProps) {
  const feedbackId = useId();
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const matches = !disabled && [...password].length >= MIN_PASSWORD_LENGTH && password === confirmation;
  const mismatch = !disabled && confirmationTouched && Boolean(confirmation) && password !== confirmation;

  return (
    <div className="lock-password">
      <div className="lock-password__fields" role="group" aria-label={changing ? "设置新密码" : "设置锁屏密码"}>
        <PasswordField
          label={changing ? "新密码" : "锁屏密码"}
          value={password}
          disabled={disabled}
          describedBy={feedbackId}
          onChange={onPasswordChange}
        />
        <PasswordField
          label={changing ? "确认新密码" : "确认密码"}
          value={confirmation}
          disabled={disabled}
          describedBy={feedbackId}
          invalid={mismatch}
          onChange={onConfirmationChange}
          onBlur={() => setConfirmationTouched(true)}
        />
      </div>
      <p id={feedbackId} className="lock-password__feedback" role="status" data-state={matches ? "match" : mismatch ? "mismatch" : undefined}>
        {matches ? <><Icon name="check" height="14" width="14" />两次密码一致</> :
          mismatch ? "两次输入的密码不一致" : `至少 ${MIN_PASSWORD_LENGTH} 个字符`}
      </p>
    </div>
  );
}

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
            <PasswordPair
              changing
              password={newPassword}
              confirmation={confirmPassword}
              disabled={busy}
              onPasswordChange={setNewPassword}
              onConfirmationChange={setConfirmPassword}
            />
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
          <div className="settings-control-group app-lock-settings__controls" role="group" aria-label="锁屏选项">
            <label className="settings-control-row">
              <span>启用锁屏</span>
              <SettingsSwitch checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.currentTarget.checked)} />
            </label>
            <label className="settings-control-row">
              <span>无操作时自动锁屏</span>
              <SettingsSwitch
                checked={autoLockEnabled}
                disabled={busy || !enabled}
                onChange={(event) => setAutoLockEnabled(event.currentTarget.checked)}
              />
            </label>
            <label className="settings-control-row">
              <span>自动锁屏时间</span>
              <span className="app-lock-settings__duration">
                <input
                  aria-label="自动锁屏时间（分钟）"
                  className="settings-number"
                  disabled={busy || !enabled || !autoLockEnabled}
                  max={240}
                  min={1}
                  onChange={(event) => setTimeoutMinutes(Number(event.currentTarget.value))}
                  type="number"
                  value={timeoutMinutes}
                />
                <span>分钟</span>
              </span>
            </label>
          </div>

          {status.settings.hasPassword ? (
            <div className="settings-section__head">
              <h3>锁屏密码</h3>
              <div className="settings-config__actions">
                <Button disabled={busy} onClick={() => setPasswordDialog("change")} variant="secondary">修改锁屏密码</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="settings-section__head">
                <h3>设置锁屏密码</h3>
              </div>
              <PasswordPair
                password={newPassword}
                confirmation={confirmPassword}
                disabled={busy || !enabled}
                onPasswordChange={setNewPassword}
                onConfirmationChange={setConfirmPassword}
              />
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
