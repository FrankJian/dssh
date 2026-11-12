import { useState, type FormEvent } from "react";
import type { SmbProfile } from "../models/smb";
import { saveSmbProfile } from "../services/smbService";
import { ConnectionFolderField } from "../ssh/ConnectionFolderField";
import { normalizeConnectionFolder } from "../ssh/connectionFolders";
import { TagInput } from "../ssh/TagInput";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../rdp/useDialogFocus";

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
    <section ref={dialogRef} className="profile-editor is-glass-overlay rdp-editor" role="dialog" aria-modal="true"
      aria-label={profile && !clone ? "编辑网络共享" : "新建网络共享"}
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <header className="profile-editor__topbar"><h2>{profile && !clone ? "编辑" : "新建"}网络共享</h2>
        <button className="icon-button" type="button" aria-label="关闭编辑器" disabled={busy} onClick={onClose}><Icon name="close" /></button></header>
      <form className="rdp-editor__form" onSubmit={submit}>
        {error ? <div className="form-errors" role="alert">{error}</div> : null}
        <p className="profile-form__hint">Windows 使用当前登录身份连接 SMB 共享。映射后会在文件资源管理器打开盘符；如需其他账户，请先在 Windows 凭据管理器配置。</p>
        <ConnectionFolderField value={draft.folder} disabled={busy} onChange={(value) => field("folder", value)} />
        <label className="field"><span>名称</span><input autoFocus required maxLength={160} value={draft.name} onChange={(e) => field("name", e.target.value)} /></label>
        <label className="field"><span>共享路径</span><input required spellCheck={false} placeholder={"\\\\server\\share"} value={draft.sharePath} onChange={(e) => field("sharePath", e.target.value)} /></label>
        <label className="field"><span>映射盘符</span><input required maxLength={2} spellCheck={false} placeholder="Z:" value={draft.driveLetter} onChange={(e) => field("driveLetter", e.target.value)} /></label>
        <TagInput value={draft.tags} suggestions={allTags} onChange={(tags) => field("tags", tags)} />
        <label className="field"><span>说明</span><textarea maxLength={4096} value={draft.description} onChange={(e) => field("description", e.target.value)} /></label>
        <footer className="rdp-editor__actions"><Button disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</Button></footer>
      </form>
    </section>
  </div>;
}
