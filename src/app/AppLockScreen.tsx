import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useDialogFocus } from "../rdp/useDialogFocus";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface AppLockScreenProps {
  locked: boolean;
  onUnlock: (password: string) => Promise<void>;
}

const UNLOCK_TRANSITION_MS = 1200;

export function AppLockScreen({ locked, onUnlock }: AppLockScreenProps) {
  const [present, setPresent] = useState(locked);
  useEffect(() => {
    if (locked) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const timer = window.setTimeout(() => setPresent(false), UNLOCK_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [locked, present]);

  // Backend lock state remains immediate, including events from other windows.
  // Unmount the password form first; only the dismissible welcome layer lingers.
  if (locked) return <LockedScreen onUnlock={onUnlock} />;
  if (!present) return null;
  return <UnlockWelcome onContinue={() => setPresent(false)} />;
}

function UnlockWelcome({ onContinue }: { onContinue: () => void }) {
  const dialogRef = useDialogFocus();
  return <section ref={dialogRef} className="app-lock-screen app-lock-screen--unlocked" role="dialog" aria-modal="true" aria-labelledby="app-unlock-title" aria-describedby="app-unlock-description"
    style={{ "--lock-unlock-duration": `${UNLOCK_TRANSITION_MS}ms` } as CSSProperties}>
    <LockScreenBrand />
    <div className="app-lock-screen__watermark" aria-hidden="true"><Icon name="lockOpen" strokeWidth="1.5" /></div>
    <div className="app-lock-screen__content">
      <div className="app-lock-screen__welcome">
        <span className="app-lock-screen__welcome-badge"><Icon name="check" height="14" width="14" />工作区已解锁</span>
        <h1 id="app-unlock-title">欢迎回来<span aria-hidden="true">。</span></h1>
        <p id="app-unlock-description">一切就绪，继续你的工作。</p>
        <div className="app-lock-screen__welcome-progress" aria-hidden="true"><span /></div>
        <Button className="app-lock-screen__welcome-continue" variant="ghost" onClick={onContinue}>立即进入<Icon name="arrowRight" height="14" width="14" /></Button>
      </div>
    </div>
  </section>;
}

function LockScreenBrand() {
  return <header className="app-lock-screen__brand">
    <span className="app-lock-screen__brand-mark"><Icon name="terminalTool" /></span>
    <span>Duo SSH</span>
    <span className="app-lock-screen__brand-divider" aria-hidden="true" />
    <span className="app-lock-screen__brand-caption">安全工作区</span>
  </header>;
}

function LockedScreen({ onUnlock }: Pick<AppLockScreenProps, "onUnlock">) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus();

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;
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
    <section ref={dialogRef} className="app-lock-screen" role="dialog" aria-modal="true" aria-labelledby="app-lock-title" aria-describedby="app-lock-description">
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
              disabled={busy}
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
            <button className="app-lock-screen__visibility" type="button" disabled={busy} aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible}
              onClick={() => { setVisible((value) => !value); inputRef.current?.focus(); }}>
              {visible ? "隐藏" : "显示"}
            </button>
          </div>
          <div id="app-lock-feedback" className="app-lock-screen__feedback">
            {error ? <p className="app-lock-screen__error" role="alert"><Icon name="info" height="14" width="14" /><span>{error}</span></p>
              : <p className={capsLock ? "app-lock-screen__caps-lock" : "app-lock-screen__hint"} role="status">{capsLock ? "大写锁定已开启" : "按 Enter 即可解锁"}</p>}
          </div>
          <Button className="app-lock-screen__submit" variant="primary" disabled={busy || !password} type="submit">
            <span>{busy ? "正在解锁…" : "解锁工作区"}</span><Icon name="arrowRight" height="16" width="16" />
          </Button>
        </form>
      </div>
      <footer className="app-lock-screen__footer"><Icon name="shield" height="14" width="14" /><span>工作区内容已隐藏</span></footer>
    </section>
  );
}
