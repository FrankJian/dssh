import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface ConfigPasswordDialogProps {
  mode: "export" | "import";
  busy?: boolean;
  error?: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function ConfigPasswordDialog({
  mode,
  busy = false,
  error,
  onSubmit,
  onCancel,
}: ConfigPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isExport = mode === "export";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (!password) {
      setLocalError("请输入密码。");
      return;
    }
    if (isExport && password !== confirm) {
      setLocalError("两次输入的密码不一致。");
      return;
    }
    setLocalError(null);
    onSubmit(password);
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="config-password" aria-label={isExport ? "设置导出密码" : "输入导入密码"}>
        <header className="config-password__header">
          <h3>{isExport ? "设置导出密码" : "输入导入密码"}</h3>
          <button aria-label="关闭" className="icon-button" onClick={onCancel} type="button">
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        <p className="config-password__hint">
          {isExport
            ? "导出的配置将使用此密码加密。请牢记密码，导入时需要用它解密，密码无法找回。"
            : "请输入导出该文件时设置的密码进行解密。"}
        </p>

        <form className="config-password__form" onSubmit={handleSubmit}>
          <label className="field">
            <span>密码</span>
            <input
              autoFocus
              disabled={busy}
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              value={password}
            />
          </label>
          {isExport ? (
            <label className="field">
              <span>确认密码</span>
              <input
                disabled={busy}
                onChange={(event) => setConfirm(event.currentTarget.value)}
                type="password"
                value={confirm}
              />
            </label>
          ) : null}

          {localError || error ? (
            <div className="config-password__error" role="alert">
              {localError ?? error}
            </div>
          ) : null}

          <div className="config-password__actions">
            <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">
              取消
            </Button>
            <Button disabled={busy} type="submit" variant="primary">
              {busy ? "处理中…" : isExport ? "加密并导出" : "解密并导入"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
