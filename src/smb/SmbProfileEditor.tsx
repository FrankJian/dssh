import { isMacOS } from "../platform";
import { useId, useState, type FormEvent } from "react";
import type { SmbProfile } from "../models/smb";
import { saveSmbProfile } from "../services/smbService";
import { ConnectionFolderField } from "../ssh/ConnectionFolderField";
import { normalizeConnectionFolder } from "../ssh/connectionFolders";
import { TagInput } from "../ssh/TagInput";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../rdp/useDialogFocus";
import "./smbEditor.css";

interface Props {
  profile: SmbProfile | null;
  clone?: boolean;
  initialTags?: string[];
  initialFolder?: string;
  allTags: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function SmbProfileEditor({ profile, clone, initialTags, initialFolder, allTags, onClose, onSaved }: Props) {
  const dialogRef = useDialogFocus();
  const [draft, setDraft] = useState<SmbProfile>(() => profile
    ? { ...profile, id: clone ? "" : profile.id, name: clone ? `${profile.name} 克隆` : profile.name, tags: [...profile.tags] }
    : { id: "", name: "", folder: initialFolder ?? "", sharePath: "", driveLetter: "Z", favorite: false,
      tags: initialTags ?? [], description: "", createdAt: "", updatedAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(() => Boolean(draft.folder || draft.tags.length || draft.description));
  const titleId = useId();
  const detailsId = useId();
  const tagsId = useId();
  function field<K extends keyof SmbProfile>(key: K, value: SmbProfile[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await saveSmbProfile({ ...draft, folder: normalizeConnectionFolder(draft.folder) });
      await onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "保存网络共享失败。"); }
    finally { setBusy(false); }
  }
  return <div className="profile-editor-backdrop" role="presentation">
    <section ref={dialogRef} className="profile-editor is-glass-overlay smb-editor" role="dialog" aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <header className="profile-editor__topbar smb-editor__header">
        <div className="smb-editor__heading">
          <Icon name="folder" width="18" height="18" />
          <h2 id={titleId}>{profile && !clone ? "编辑" : "新建"} SMB 网络共享</h2>
        </div>
        <button className="icon-button" type="button" aria-label="关闭编辑器" disabled={busy} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <form className="smb-editor__form" onSubmit={submit}>
        <div className="smb-editor__body">
          {error ? <div className="form-errors" role="alert">{error}</div> : null}
          <label className="field">
            <span>连接名称</span>
            <input required maxLength={160} placeholder="例如：团队共享" value={draft.name}
              onChange={(event) => field("name", event.target.value)} />
          </label>
          <div className="smb-editor__endpoint">
            <label className="field">
              <span>共享路径</span>
              <input className="smb-editor__path" required spellCheck={false} autoComplete="off"
                placeholder={isMacOS ? "smb://server/share" : "\\\\server\\share"} value={draft.sharePath}
                onChange={(event) => field("sharePath", event.target.value)} />
            </label>
            {!isMacOS ? <label className="field">
              <span>映射盘符</span>
              <input className="smb-editor__drive" required maxLength={2} spellCheck={false}
                placeholder="Z:" value={draft.driveLetter} onChange={(event) => field("driveLetter", event.target.value)} />
            </label> : null}
          </div>
          <p className="smb-editor__credentials profile-form__hint">
            <Icon name="shield" width="15" height="15" />
            <span>{isMacOS
              ? "在 Finder 登录时勾选「在我的钥匙串中记住此密码」，下次连接可复用凭据。"
              : "要记住账号和密码，请在 Windows 凭据管理器中为该服务器添加凭据。"}</span>
          </p>
          <div className="smb-editor__details">
            <button type="button" className="smb-editor__disclosure" aria-expanded={showDetails}
              aria-controls={detailsId} onClick={() => setShowDetails((open) => !open)}>
              <Icon name={showDetails ? "chevron-down" : "chevron-right"} width="14" height="14" />
              <span>目录、标签和说明</span>
              <span className="profile-form__hint">选填</span>
            </button>
            <div id={detailsId} className="smb-editor__metadata" hidden={!showDetails}>
              <ConnectionFolderField value={draft.folder} disabled={busy} onChange={(value) => field("folder", value)} />
              <div className="field">
                <label htmlFor={tagsId}>标签</label>
                <TagInput inputId={tagsId} placeholder="输入标签后按回车" value={draft.tags} suggestions={allTags}
                  onChange={(tags) => field("tags", tags)} />
              </div>
              <label className="field">
                <span>说明</span>
                <textarea rows={2} maxLength={4096} value={draft.description}
                  onChange={(event) => field("description", event.target.value)} />
              </label>
            </div>
          </div>
        </div>
        <footer className="smb-editor__footer">
          <Button disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存连接"}</Button>
        </footer>
      </form>
    </section>
  </div>;
}
