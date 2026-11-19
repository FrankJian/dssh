import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { useId } from "react";
import type { SshAuthDraft } from "./authDraft";

interface Props {
  draft: SshAuthDraft;
  onChange: (changes: Partial<SshAuthDraft>) => void;
  onError: (message: string) => void;
  keepPassword?: boolean;
  keepPassphrase?: boolean;
  clearPassphrase?: boolean;
  onClearPassphrase?: (clear: boolean) => void;
  disabled?: boolean;
}

export function SshAuthenticationFields({
  draft, onChange, onError, keepPassword, keepPassphrase,
  clearPassphrase, onClearPassphrase, disabled,
}: Props) {
  const authId = useId();

  async function selectKey() {
    try {
      const path = await open({ directory: false, multiple: false, title: "选择密钥文件" });
      if (typeof path === "string") {
        onChange({ keyFilePath: path, keyName: path.split(/[\\/]/).pop() ?? "key" });
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "无法选择密钥文件。");
    }
  }

  return (
    <>
      <label className="field">
        <span>用户名</span>
        <input autoComplete="off" disabled={disabled} value={draft.username}
          onChange={(event) => onChange({ username: event.currentTarget.value })} />
      </label>
      <div className="field">
        <span id={authId}>认证方式</span>
        <div className="ssh-auth-toggle" role="radiogroup" aria-labelledby={authId}>
          <label className="ssh-auth-toggle__option">
            <input
              checked={draft.authType === "password"}
              disabled={disabled}
              name={authId}
              onChange={() => onChange({ authType: "password" })}
              type="radio"
              value="password"
            />
            <span>密码</span>
          </label>
          <label className="ssh-auth-toggle__option">
            <input
              checked={draft.authType === "privateKey"}
              disabled={disabled}
              name={authId}
              onChange={() => onChange({ authType: "privateKey" })}
              type="radio"
              value="privateKey"
            />
            <span>私钥</span>
          </label>
        </div>
      </div>
      {draft.authType === "password" ? (
        <label className="field">
          <span>{keepPassword ? "密码（留空则保留原密码）" : "密码"}</span>
          <input autoComplete="new-password" disabled={disabled} type="password" value={draft.password}
            onChange={(event) => onChange({ password: event.currentTarget.value })} />
        </label>
      ) : (
        <>
          <div className="form-grid">
            <div className="field">
              <span>密钥文件</span>
              <div className="key-upload">
                <Button disabled={disabled} onClick={() => void selectKey()} variant="ghost">
                  {draft.keyName ? "更换文件" : "选择密钥"}
                </Button>
                <span className="key-upload__name">{draft.keyName || "未选择密钥文件"}</span>
              </div>
            </div>
            <label className="field">
              <span>{keepPassphrase ? "私钥口令（留空则保留原口令）" : "私钥口令（可选）"}</span>
              <input autoComplete="new-password" disabled={disabled || clearPassphrase}
                type="password" value={clearPassphrase ? "" : draft.passphrase}
                onChange={(event) => onChange({ passphrase: event.currentTarget.value })} />
            </label>
          </div>
          {keepPassphrase && onClearPassphrase ? (
            <label className="ssh-credentials__clear">
              <input checked={clearPassphrase} disabled={disabled} type="checkbox"
                onChange={(event) => onClearPassphrase(event.currentTarget.checked)} />
              清除已保存的私钥口令
            </label>
          ) : null}
        </>
      )}
    </>
  );
}
