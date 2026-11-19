import { ConnectionFolderField } from "./ConnectionFolderField";
import { useEffect, useState, type FormEvent } from "react";
import type { SshProfile } from "../models";
import type { SshCredential } from "../models/sshCredential";
import { listSshCredentials } from "../services/sshCredentialService";
import { SshAuthenticationFields } from "./SshAuthenticationFields";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SelectMenu, type SelectMenuOption } from "../ui/SelectMenu";
import {
  CONNECTION_TYPE_OPTIONS,
  connectionTypeLabel,
  type ConnectionType,
} from "./connectionTypes";
import { TagInput } from "./TagInput";
import { validateProfileDraft } from "./profileStore";
import {
  createEmptyProfileDraft,
  embeddedAuth,
  newCredentialAuth,
  profileToDraft,
  profileToCloneDraft,
  type ProfileDraft,
  type ProfileEditorMode,
} from "./profileTypes";
import { SSH_PROFILE_ICON_OPTIONS } from "./profileIcons";

interface ProfileEditorProps {
  mode: ProfileEditorMode;
  profile: SshProfile | null;
  allTags: string[];
  initialTags?: string[];
  initialFolder?: string;
  initialConnectionType?: "ssh" | "sftp";
  onClose: () => void;
  onSubmit: (draft: ProfileDraft) => Promise<void>;
  onCreateRdp?: (folder: string) => void;
  onCreateSmb?: (folder: string) => void;
  onCreateJumpServer?: (folder: string) => void;
}

type ConnectionRoute = "direct" | "socks5" | "http";

const CONNECTION_ROUTE_OPTIONS: readonly SelectMenuOption[] = [
  { label: "直连", value: "direct" },
  { disabled: true, label: "代理命令（即将支持）", value: "proxyCommand" },
  { disabled: true, label: "跳板主机（即将支持）", value: "jumpHost" },
  { label: "SOCKS5 代理", value: "socks5" },
  { label: "HTTP 代理", value: "http" },
];

export function ProfileEditor({ allTags, initialTags, initialFolder, initialConnectionType = "ssh", mode, onClose, onSubmit, profile, onCreateRdp, onCreateSmb, onCreateJumpServer }: ProfileEditorProps) {
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    profile ? (mode === "create" ? profileToCloneDraft(profile) : profileToDraft(profile)) : { ...createEmptyProfileDraft(), connectionType: initialConnectionType, tags: [...(initialTags ?? [])], folder: initialFolder ?? "" },
  );
  const [connectionType, setConnectionType] = useState<ConnectionType>(profile?.connectionType ?? initialConnectionType);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<SshCredential[] | null>(null);
  const [credentialError, setCredentialError] = useState("");
  const [credentialReload, setCredentialReload] = useState(0);

  useEffect(() => {
    let active = true;
    void listSshCredentials().then((items) => {
      if (active) {
        setCredentials(items);
        setCredentialError("");
      }
    }).catch((error: Error) => {
      if (active) setCredentialError(error.message);
    });
    return () => { active = false; };
  }, [credentialReload]);

  useEffect(() => {
    setDraft(profile ? (mode === "create" ? profileToCloneDraft(profile) : profileToDraft(profile)) : { ...createEmptyProfileDraft(), connectionType: initialConnectionType, tags: [...(initialTags ?? [])], folder: initialFolder ?? "" });
    setConnectionType(profile?.connectionType ?? initialConnectionType);
    setErrors([]);
  }, [initialTags, initialFolder, initialConnectionType, mode, profile]);

  function updateDraft<Field extends keyof ProfileDraft>(field: Field, value: ProfileDraft[Field]) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  function updateConnectionRoute(route: ConnectionRoute) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      proxyType: route === "direct" ? currentDraft.proxyType : route,
      useProxy: route !== "direct",
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;
    const validationErrors = validateProfileDraft(draft, Boolean(profile?.credentialId));
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      await onSubmit(draft);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "保存 SSH 配置失败。"]);
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "create" ? `新建 ${connectionTypeLabel(connectionType)} 连接` : `编辑 ${connectionTypeLabel(connectionType)} 连接`;
  const useEmbeddedAuth = draft.authSource === embeddedAuth;
  const createCredential = draft.authSource === newCredentialAuth;
  const useSavedCredential = !useEmbeddedAuth && !createCredential;
  const savedCredential = credentials?.find((credential) => credential.id === draft.authSource);
  const credentialOptions = [
    { value: embeddedAuth, label: "保存在连接中" },
    { value: newCredentialAuth, label: "新建可复用凭据" },
    ...(credentials ?? []).map((credential) => ({
      value: credential.id,
      label: `${credential.name} · ${credential.username}`,
    })),
  ];
  if (useSavedCredential && !savedCredential) {
    credentialOptions.push({
      value: draft.authSource,
      label: credentials ? "凭据已删除" : "已关联凭据",
    });
  }
  const keepAuth = useEmbeddedAuth && profile && !profile.credentialId && profile.authMethod.type === draft.authType;
  const connectionRoute: ConnectionRoute = draft.useProxy ? draft.proxyType : "direct";
  const proxyLabel = connectionRoute === "http" ? "HTTP 代理" : "SOCKS5 代理";

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="profile-editor profile-editor--connection is-glass-overlay" aria-label={title}>
        <header className="profile-editor__topbar">
          <h2>{title}</h2>
          <button
            aria-label="关闭编辑器"
            className="icon-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        <form className="profile-form profile-form--connection" onSubmit={handleSubmit}>
          {errors.length > 0 ? (
            <div className="form-errors" role="alert">
              {errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}

          <aside className="profile-form__sidebar">
            {mode === "create" ? (
              <label className="field">
                <span>连接类型</span>
                <SelectMenu
                  ariaLabel="连接类型"
                  onChange={(value) => { if (value === "rdp") onCreateRdp?.(draft.folder); else if (value === "smb") onCreateSmb?.(draft.folder); else if (value === "jumpserver") onCreateJumpServer?.(draft.folder); else if (value === "ssh" || value === "sftp") { setConnectionType(value); updateDraft("connectionType", value); } }}
                  options={CONNECTION_TYPE_OPTIONS.map((option) => ({
                    disabled: !option.available,
                    label: option.available ? option.label : `${option.label}（即将支持）`,
                    value: option.id,
                  }))}
                  value={connectionType}
                />
                <small className="profile-form__hint">SFTP 默认打开文件管理，也可主动打开 SSH 终端。</small>
              </label>
            ) : null}

            <fieldset className="profile-icon-picker">
              <legend>连接图标</legend>
              <div aria-label="连接图标" className="profile-icon-picker__options" role="group">
                {SSH_PROFILE_ICON_OPTIONS.map((option) => (
                  <button
                    aria-pressed={draft.icon === option.id}
                    className={`profile-icon-picker__option${draft.icon === option.id ? " is-selected" : ""}`}
                    key={option.id}
                    onClick={() => updateDraft("icon", option.id)}
                    title={option.label}
                    type="button"
                  >
                    <Icon name={option.icon} height="18" width="18" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span>名称</span>
              <input
                autoFocus
                onChange={(event) => updateDraft("name", event.currentTarget.value)}
                value={draft.name}
              />
            </label>

            <div className="field">
              <span>分组（标签）</span>
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


          </aside>

          <div className="profile-form__main">
            <ConnectionFolderField value={draft.folder} onChange={(value) => updateDraft("folder", value)} />
            {mode === "create" && profile ? <p className="profile-form__hint">正在克隆“{profile.name}”。</p> : null}
            <div className="profile-form__connection-grid">
              <label className="field">
                <span>连接方式</span>
                <SelectMenu
                  ariaLabel="连接方式"
                  onChange={(value) => updateConnectionRoute(value as ConnectionRoute)}
                  options={CONNECTION_ROUTE_OPTIONS}
                  value={connectionRoute}
                />
              </label>
              <label className="field">
                <span>主机（IP 或域名）</span>
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
            </div>

            {draft.useProxy ? (
              <div className="profile-form__proxy-grid">
                <label className="field profile-form__proxy-host">
                  <span>{proxyLabel}主机</span>
                  <input
                    onChange={(event) => updateDraft("proxyHost", event.currentTarget.value)}
                    value={draft.proxyHost}
                  />
                </label>
                <label className="field">
                  <span>{proxyLabel}端口</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) => updateDraft("proxyPort", event.currentTarget.value)}
                    value={draft.proxyPort}
                  />
                </label>
                <label className="field">
                  <span>代理用户名（可选）</span>
                  <input
                    onChange={(event) => updateDraft("proxyUsername", event.currentTarget.value)}
                    value={draft.proxyUsername}
                  />
                </label>
                <label className="field">
                  <span>代理密码（可选）</span>
                  <input
                    onChange={(event) => updateDraft("proxyPassword", event.currentTarget.value)}
                    type="password"
                    value={draft.proxyPassword}
                  />
                </label>
              </div>
            ) : null}

            <div className="field">
              <span>认证来源</span>
              <SelectMenu ariaLabel="认证来源" disabled={saving}
                onChange={(value) => updateDraft("authSource", value)}
                options={credentialOptions} searchable value={draft.authSource} />
              {credentialError ? (
                <div className="ssh-credentials__inline-status" role="status">
                  <span>{credentialError}</span>
                  <Button onClick={() => setCredentialReload((current) => current + 1)} variant="ghost">重试</Button>
                </div>
              ) : credentials === null ? <small className="profile-form__hint">正在加载凭据…</small> : null}
            </div>
            {useSavedCredential ? (
              <p className="profile-form__hint">
                {savedCredential ? `${savedCredential.authMethod.type === "password" ? "密码认证" : "私钥认证"} · 更新此凭据后，新连接和手动重连会使用最新认证信息。`
                  : credentials ? "请重新选择认证来源。" : null}
              </p>
            ) : (
              <>
                {createCredential ? (
                  <label className="field">
                    <span>凭据名称</span>
                    <input disabled={saving} value={draft.credentialName}
                      onChange={(event) => updateDraft("credentialName", event.currentTarget.value)} />
                  </label>
                ) : null}
                <SshAuthenticationFields
                  disabled={saving}
                  draft={createCredential && !draft.keyFilePath ? { ...draft, keyName: "" } : draft}
                  keepPassword={Boolean(keepAuth && draft.authType === "password")}
                  keepPassphrase={Boolean(keepAuth && draft.authType === "privateKey" && (mode === "edit" || !draft.keyFilePath))}
                  onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
                  onError={(message) => setErrors([message])}
                />
              </>
            )}
          </div>

          <footer className="profile-editor__footer">
            <Button disabled={saving} onClick={onClose} variant="ghost">
              取消
            </Button>
            <Button disabled={saving || Boolean(useSavedCredential && credentials && !savedCredential)} type="submit" variant="primary">
              {saving ? "正在保存…" : mode === "create" ? "创建配置" : "保存修改"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
