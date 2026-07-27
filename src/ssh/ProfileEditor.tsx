import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type FormEvent } from "react";
import type { SshProfile } from "../models";
import { readKeyFile } from "../services/sshProfileService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { TagInput } from "./TagInput";
import { validateProfileDraft } from "./profileStore";
import {
  createEmptyProfileDraft,
  profileToDraft,
  type ProfileDraft,
  type ProfileEditorMode,
} from "./profileTypes";

interface ProfileEditorProps {
  mode: ProfileEditorMode;
  profile: SshProfile | null;
  allTags: string[];
  onClose: () => void;
  onSubmit: (draft: ProfileDraft) => Promise<void>;
}

export function ProfileEditor({ allTags, mode, onClose, onSubmit, profile }: ProfileEditorProps) {
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    profile ? profileToDraft(profile) : createEmptyProfileDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setDraft(profile ? profileToDraft(profile) : createEmptyProfileDraft());
    setErrors([]);
  }, [profile]);

  function updateDraft<Field extends keyof ProfileDraft>(field: Field, value: ProfileDraft[Field]) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  async function handleUploadKey() {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择密钥文件",
      });
      if (typeof selected !== "string") {
        return;
      }
      const content = await readKeyFile(selected);
      const fileName = selected.split(/[\\/]/).pop() ?? "key";
      setDraft((currentDraft) => ({
        ...currentDraft,
        keyData: content,
        keyName: fileName,
      }));
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "读取密钥文件失败。"]);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationErrors = validateProfileDraft(draft);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    try {
      await onSubmit(draft);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "保存 SSH 配置失败。"]);
    }
  }

  const title = mode === "create" ? "新建 SSH 配置" : "编辑 SSH 配置";
  const passwordLabel = mode === "create" ? "密码" : "密码（留空则保持不变）";

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="profile-editor" aria-label={title}>
        <header className="profile-editor__topbar">
          <h2>{title}</h2>
          <button
            aria-label="关闭编辑器"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        <form className="profile-form" onSubmit={handleSubmit}>
          {errors.length > 0 ? (
            <div className="form-errors" role="alert">
              {errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}

          <div className="form-grid">
            <label className="field">
              <span>名称</span>
              <input
                autoFocus
                onChange={(event) => updateDraft("name", event.currentTarget.value)}
                value={draft.name}
              />
            </label>
            <label className="field">
              <span>主机</span>
              <input
                onChange={(event) => updateDraft("host", event.currentTarget.value)}
                value={draft.host}
              />
            </label>
            <label className="field">
              <span>端口</span>
              <input
                inputMode="numeric"
                onChange={(event) => updateDraft("port", event.currentTarget.value)}
                value={draft.port}
              />
            </label>
            <label className="field">
              <span>用户名</span>
              <input
                onChange={(event) => updateDraft("username", event.currentTarget.value)}
                value={draft.username}
              />
            </label>
          </div>

          <fieldset className="auth-fieldset">
            <legend>认证方式</legend>
            <label>
              <input
                checked={draft.authType === "password"}
                name="authType"
                onChange={() => updateDraft("authType", "password")}
                type="radio"
              />
              密码
            </label>
            <label>
              <input
                checked={draft.authType === "privateKey"}
                name="authType"
                onChange={() => updateDraft("authType", "privateKey")}
                type="radio"
              />
              密钥
            </label>
          </fieldset>

          {draft.authType === "password" ? (
            <label className="field">
              <span>{passwordLabel}</span>
              <input
                onChange={(event) => updateDraft("password", event.currentTarget.value)}
                type="password"
                value={draft.password}
              />
            </label>
          ) : (
            <div className="form-grid">
              <div className="field">
                <span>密钥文件</span>
                <div className="key-upload">
                  <Button onClick={handleUploadKey} variant="ghost">
                    {draft.keyName ? "重新上传" : "上传密钥"}
                  </Button>
                  <span className="key-upload__name">
                    {draft.keyName
                      ? draft.keyData
                        ? `已选择：${draft.keyName}`
                        : `已存储：${draft.keyName}`
                      : "未选择密钥文件"}
                  </span>
                </div>
              </div>
              <label className="field">
                <span>Passphrase（可选）</span>
                <input
                  onChange={(event) => updateDraft("passphrase", event.currentTarget.value)}
                  type="password"
                  value={draft.passphrase}
                />
              </label>
            </div>
          )}

          <fieldset className="auth-fieldset">
            <legend>连接代理</legend>
            <label>
              <input
                checked={draft.useProxy}
                onChange={(event) => updateDraft("useProxy", event.currentTarget.checked)}
                type="checkbox"
              />
              通过代理连接 SSH
            </label>
          </fieldset>

          {draft.useProxy ? (
            <div className="form-grid">
              <label className="field">
                <span>代理类型</span>
                <select
                  onChange={(event) => updateDraft("proxyType", event.currentTarget.value as "socks5" | "http")}
                  value={draft.proxyType}
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP CONNECT</option>
                </select>
              </label>
              <label className="field">
                <span>代理主机</span>
                <input onChange={(event) => updateDraft("proxyHost", event.currentTarget.value)} value={draft.proxyHost} />
              </label>
              <label className="field">
                <span>代理端口</span>
                <input inputMode="numeric" onChange={(event) => updateDraft("proxyPort", event.currentTarget.value)} value={draft.proxyPort} />
              </label>
              <label className="field">
                <span>代理用户名（可选）</span>
                <input onChange={(event) => updateDraft("proxyUsername", event.currentTarget.value)} value={draft.proxyUsername} />
              </label>
              <label className="field">
                <span>代理密码（可选）</span>
                <input onChange={(event) => updateDraft("proxyPassword", event.currentTarget.value)} type="password" value={draft.proxyPassword} />
              </label>
            </div>
          ) : null}

          <div className="field">
            <span>标签</span>
            <TagInput
              onChange={(tags) => updateDraft("tags", tags)}
              suggestions={allTags}
              value={draft.tags}
            />
          </div>

          <label className="field">
            <span>描述</span>
            <textarea
              onChange={(event) => updateDraft("description", event.currentTarget.value)}
              rows={3}
              value={draft.description}
            />
          </label>

          <label className="checkbox-field">
            <input
              checked={draft.favorite}
              onChange={(event) => updateDraft("favorite", event.currentTarget.checked)}
              type="checkbox"
            />
            设为收藏
          </label>

          <footer className="profile-editor__footer">
            <Button onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button type="submit" variant="primary">
              {mode === "create" ? "创建配置" : "保存修改"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
