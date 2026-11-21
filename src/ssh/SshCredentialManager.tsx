import { useEffect, useState, type FormEvent } from "react";
import type { SaveSshCredentialRequest, SshCredential } from "../models/sshCredential";
import { useDialogFocus } from "../ui/useDialogFocus";
import { deleteSshCredential, listSshCredentials, saveSshCredential } from "../services/sshCredentialService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { buildAuthRequest, createAuthDraft } from "./authDraft";
import { SshAuthenticationFields } from "./SshAuthenticationFields";

type View = { type: "list" } | { type: "edit"; credential?: SshCredential }
  | { type: "delete"; credential: SshCredential };

export function SshCredentialManager({ onClose }: { onClose: () => void }) {
  const dialog = useDialogFocus();
  const [credentials, setCredentials] = useState<SshCredential[] | null>(null);
  const [view, setView] = useState<View>({ type: "list" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void listSshCredentials().then((items) => {
      if (active) setCredentials(items);
    }).catch((error: Error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [reload]);

  function changeView(next: View) {
    setView(next);
    setError("");
  }

  async function remove(credential: SshCredential) {
    setBusy(true);
    setError("");
    try {
      await deleteSshCredential(credential.id);
      setCredentials((current) => current?.filter((item) => item.id !== credential.id) ?? []);
      changeView({ type: "list" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除凭据失败。");
    } finally {
      setBusy(false);
    }
  }

  function back() {
    if (view.type === "list") onClose();
    else changeView({ type: "list" });
  }

  const title = view.type === "list" ? "SSH 凭据管理"
    : view.type === "delete" ? "删除 SSH 凭据"
    : view.credential ? "编辑 SSH 凭据" : "新建 SSH 凭据";

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section aria-label={title} aria-modal="true" className="profile-editor ssh-credentials is-glass-overlay"
        ref={dialog} role="dialog" onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            back();
          }
        }}>
        <header className="ssh-credentials__header">
          <div className="ssh-credentials__heading">
            <span className="ssh-credentials__mark" aria-hidden="true"><Icon name="fileKey" height="18" width="18" /></span>
            <h2>{title}</h2>
          </div>
          <button aria-label={view.type === "list" ? "关闭" : "返回凭据列表"}
            className="icon-button" disabled={busy} onClick={back} type="button">
            <Icon name={view.type === "list" ? "close" : "arrowLeft"} height="16" width="16" />
          </button>
        </header>
        {view.type === "edit" ? (
          <CredentialForm credential={view.credential} busy={busy} error={error} onCancel={back}
            onError={setError} onSave={async (request) => {
              setBusy(true);
              setError("");
              try {
                const saved = await saveSshCredential(request, view.credential?.id);
                setCredentials((current) => [...(current ?? []).filter((item) => item.id !== saved.id), saved]
                  .sort((left, right) => left.name.localeCompare(right.name)));
                changeView({ type: "list" });
              } catch (error) {
                setError(error instanceof Error ? error.message : "保存凭据失败。");
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <div className="ssh-credentials__body">
            {error ? <div className="form-errors" role="alert">{error}</div> : null}
            {view.type === "delete" ? (
              <>
                <p className="ssh-credentials__message">删除“{view.credential.name}”及其保存的认证信息？</p>
                <footer className="ssh-credentials__footer">
                  <Button autoFocus disabled={busy} onClick={back}>取消</Button>
                  <Button disabled={busy}
                    onClick={() => void remove(view.credential)} variant="danger">
                    {busy ? "正在删除…" : "删除凭据"}
                  </Button>
                </footer>
              </>
            ) : (
              <>
                {credentials && credentials.length > 0 ? (
                  <div className="ssh-credentials__toolbar">
                    <span className="ssh-credentials__count">{credentials.length} 个凭据</span>
                    <Button onClick={() => changeView({ type: "edit" })} variant="primary">
                      <Icon name="plus" height="16" width="16" />新建凭据
                    </Button>
                  </div>
                ) : null}
                {credentials?.length ? (
                  <ul className="ssh-credentials__list">
                    {credentials.map((credential) => (
                      <li className="ssh-credentials__row" key={credential.id}>
                        <span className="ssh-credentials__item-icon" aria-hidden="true"><Icon name="fileKey" height="18" width="18" /></span>
                        <div className="ssh-credentials__identity">
                          <strong>{credential.name}</strong>
                          <small>{credential.username} · {credential.authMethod.type === "password" ? "密码认证" : "私钥认证"}</small>
                        </div>
                        <span className="ssh-credentials__usage">{credential.connectionCount} 个连接</span>
                        <button aria-label={`编辑 ${credential.name}`} className="icon-button"
                          onClick={() => changeView({ type: "edit", credential })} type="button">
                          <Icon name="edit" height="16" width="16" />
                        </button>
                        <button aria-label={`删除 ${credential.name}`} className="icon-button"
                          disabled={credential.connectionCount > 0}
                          title={credential.connectionCount > 0 ? "仍有连接在使用此凭据" : "删除凭据"}
                          onClick={() => changeView({ type: "delete", credential })} type="button">
                          <Icon name="trash" height="16" width="16" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : credentials ? (
                  <div className="ssh-credentials__empty">
                    <span className="ssh-credentials__empty-icon" aria-hidden="true"><Icon name="fileKey" height="24" width="24" /></span>
                    <h3>让多个连接共用一份凭据</h3>
                    <p>保存用户名与密码或私钥，<br />在 SSH 和 SFTP 连接中随时选用。</p>
                    <Button onClick={() => changeView({ type: "edit" })} variant="primary">
                      <Icon name="plus" height="16" width="16" />新建凭据
                    </Button>
                  </div>
                ) : error ? <Button onClick={() => { setError(""); setReload((value) => value + 1); }}>重试</Button>
                  : <p className="ssh-credentials__loading" role="status">正在加载凭据…</p>}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CredentialForm({ credential, busy, error, onCancel, onError, onSave }: {
  credential?: SshCredential;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onError: (message: string) => void;
  onSave: (request: SaveSshCredentialRequest) => Promise<void>;
}) {
  const [name, setName] = useState(credential?.name ?? "");
  const [auth, setAuth] = useState(() => createAuthDraft(credential?.username, credential?.authMethod));
  const [clearPassphrase, setClearPassphrase] = useState(false);
  const keepPassword = credential?.authMethod.type === "password";
  const keepKey = credential?.authMethod.type === "privateKey" && !auth.keyFilePath;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || !auth.username.trim()) {
      onError("请输入凭据名称和用户名。");
    } else if (auth.authType === "password" && !keepPassword && !auth.password) {
      onError("请输入密码。");
    } else if (auth.authType === "privateKey" && !keepKey && !auth.keyFilePath) {
      onError("请选择密钥文件。");
    } else {
      void onSave({ name, ...buildAuthRequest(auth), clearPassphrase: keepKey && clearPassphrase });
    }
  }

  return (
    <form className="ssh-credentials__form" onSubmit={submit}>
      {error ? <div className="form-errors" role="alert">{error}</div> : null}
      <label className="field">
        <span>凭据名称</span>
        <input autoFocus disabled={busy} placeholder="例如，生产环境运维账号" value={name} onChange={(event) => setName(event.currentTarget.value)} />
      </label>
      <SshAuthenticationFields draft={auth} disabled={busy} keepPassword={keepPassword} keepPassphrase={keepKey}
        clearPassphrase={keepKey && clearPassphrase} onClearPassphrase={setClearPassphrase}
        onChange={(changes) => setAuth((current) => ({ ...current, ...changes }))} onError={onError} />
      {credential && credential.connectionCount > 0 ? (
        <p className="profile-form__hint">{credential.connectionCount} 个连接会在下次连接时使用保存后的凭据。</p>
      ) : null}
      <footer className="ssh-credentials__footer">
        <Button disabled={busy} onClick={onCancel} variant="ghost">取消</Button>
        <Button disabled={busy} type="submit" variant="primary">{busy ? "正在保存…" : "保存凭据"}</Button>
      </footer>
    </form>
  );
}
