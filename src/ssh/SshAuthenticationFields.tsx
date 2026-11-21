import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsSwitch } from "../ui/SettingsSwitch";
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
        <span>认证方式</span>
        <SegmentedControl label="SSH 认证方式" className="ssh-auth-toggle" value={draft.authType}
          options={[{ value: "password", label: "密码", disabled }, { value: "privateKey", label: "私钥", disabled }]}
          onChange={(authType) => onChange({ authType })} />
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
            <label className="settings-control-row">
              <span>清除已保存的私钥口令</span>
              <SettingsSwitch checked={clearPassphrase} disabled={disabled}
                onChange={(event) => onClearPassphrase(event.currentTarget.checked)} />
            </label>
          ) : null}
        </>
      )}
    </>
  );
}
