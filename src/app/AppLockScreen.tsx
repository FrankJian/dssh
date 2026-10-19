import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../ui/Icon";

interface AppLockScreenProps {
  onUnlock: (password: string) => Promise<void>;
}

export function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
      setPassword("");
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "无法解锁应用。");
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-lock-screen" role="presentation">
      <form aria-labelledby="app-lock-title" className="app-lock-screen__dialog" onSubmit={submit}>
        <div className="app-lock-screen__icon"><Icon height="24" name="lock" width="24" /></div>
        <h1 id="app-lock-title">Duo SSH 已锁定</h1>
        <p>输入锁屏密码以继续。</p>
        <label className="app-lock-screen__field">
          <span>锁屏密码</span>
          <input
            autoComplete="current-password"
            autoFocus
            disabled={busy}
            onChange={(event) => setPassword(event.currentTarget.value)}
            ref={inputRef}
            type="password"
            value={password}
          />
        </label>
        {error ? <div className="app-lock-screen__error" role="alert">{error}</div> : null}
        <button className="button button--primary" disabled={busy || !password} type="submit">
          {busy ? "正在解锁…" : "解锁"}
        </button>
      </form>
    </div>
  );
}
