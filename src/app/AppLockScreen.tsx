import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDialogFocus } from "../rdp/useDialogFocus";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface AppLockScreenProps {
  locked: boolean;
  onUnlock: (password: string) => Promise<void>;
}

const UNLOCK_FADE_MS = 160;

export function AppLockScreen({ locked, onUnlock }: AppLockScreenProps) {
  const [present, setPresent] = useState(locked);
  useEffect(() => {
    if (locked) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const timer = window.setTimeout(() => setPresent(false), UNLOCK_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [locked, present]);

  // Only retain the visual layer after the backend has confirmed unlocking.
  // Relocking cancels the exit immediately and restores an opaque lock screen.
  return locked || present ? <LockedScreen leaving={!locked} onUnlock={onUnlock} /> : null;
}

function LockScreenBrand() {
  return <header className="app-lock-screen__brand">
    <span className="app-lock-screen__brand-mark"><Icon name="terminalTool" /></span>
    <span>Duo SSH</span>
    <span className="app-lock-screen__brand-divider" aria-hidden="true" />
    <span className="app-lock-screen__brand-caption">安全工作区</span>
  </header>;
}

function LockedScreen({ onUnlock, leaving }: Pick<AppLockScreenProps, "onUnlock"> & { leaving: boolean }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus();

  useEffect(() => {
    if (!busy && !leaving) inputRef.current?.focus();
  }, [busy, leaving]);

  useEffect(() => {
    if (leaving) {
      setPassword("");
      setVisible(false);
      setError(null);
    }
  }, [leaving]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || leaving || !password) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
      setPassword("");
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "无法解锁应用。");
      setPassword("");
    } finally {
      setVisible(false);
      setBusy(false);
    }
  }

  return (
    <section ref={dialogRef} className={`app-lock-screen${leaving ? " is-unlocking" : ""}`} style={{ animationDuration: `${UNLOCK_FADE_MS}ms` }} role="dialog" aria-modal="true" aria-labelledby="app-lock-title" aria-describedby="app-lock-description">
      <LockScreenBrand />
      <div className="app-lock-screen__watermark" aria-hidden="true"><Icon name="lock" strokeWidth="1.5" /></div>
      <div className="app-lock-screen__content">
        <form className="app-lock-screen__dialog" onSubmit={submit} aria-busy={busy}>
          <div className="app-lock-screen__intro">
            <span className="app-lock-screen__eyebrow">欢迎回来</span>
            <h1 id="app-lock-title">工作区已锁定</h1>
            <p id="app-lock-description">输入锁屏密码，继续你的工作。</p>
          </div>
          <label className="app-lock-screen__field" htmlFor="app-lock-password">锁屏密码</label>
          <div className="app-lock-screen__input" data-invalid={Boolean(error)}>
            <Icon name="lock" height="16" width="16" />
            <input
              id="app-lock-password"
              aria-invalid={Boolean(error)}
              aria-describedby="app-lock-feedback"
              autoComplete="current-password"
              autoCapitalize="none"
              autoFocus
              disabled={busy || leaving}
              onChange={(event) => { setPassword(event.currentTarget.value); setError(null); }}
              onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
              onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
              onBlur={() => setCapsLock(false)}
              placeholder="请输入锁屏密码"
              ref={inputRef}
              spellCheck={false}
              type={visible ? "text" : "password"}
              value={password}
            />
            <button className="app-lock-screen__visibility" type="button" disabled={busy || leaving} aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible}
              onClick={() => { setVisible((value) => !value); inputRef.current?.focus(); }}>
              {visible ? "隐藏" : "显示"}
            </button>
          </div>
          <div id="app-lock-feedback" className="app-lock-screen__feedback">
            {error ? <p className="app-lock-screen__error" role="alert"><Icon name="info" height="14" width="14" /><span>{error}</span></p>
              : <p className={capsLock ? "app-lock-screen__caps-lock" : "app-lock-screen__hint"} role="status">{capsLock ? "大写锁定已开启" : "按 Enter 即可解锁"}</p>}
          </div>
          <Button className="app-lock-screen__submit" variant="primary" disabled={busy || leaving || !password} type="submit">
            <span>{busy ? "正在解锁…" : "解锁工作区"}</span><Icon name="arrowRight" height="16" width="16" />
          </Button>
        </form>
      </div>
      <footer className="app-lock-screen__footer"><Icon name="shield" height="14" width="14" /><span>工作区内容已隐藏</span></footer>
    </section>
  );
}
