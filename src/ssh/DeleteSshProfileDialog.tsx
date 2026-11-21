import { useState } from "react";
import type { SshProfile } from "../models";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useDialogFocus } from "../ui/useDialogFocus";

interface Props {
  profile: SshProfile;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteSshProfileDialog({ profile, onClose, onConfirm }: Props) {
  const dialogRef = useDialogFocus();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除 SSH 配置失败。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section ref={dialogRef} className="ssh-delete-dialog" role="dialog" aria-modal="true" aria-label="确认删除连接配置"
        onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !deleting) { event.stopPropagation(); onClose(); } }}>
        <header className="profile-editor__topbar">
          <h2>确认删除配置</h2>
          <button aria-label="关闭" className="icon-button" disabled={deleting} onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="ssh-delete-dialog__body">
          <p>确定删除连接配置“{profile.name}”吗？</p>
          <p className="ssh-delete-dialog__warning">此操作会删除连接管理和 SFTP 连接库共享的配置，无法撤销。</p>
          {error ? <div className="form-errors" role="alert">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={deleting} onClick={onClose} variant="secondary">取消</Button>
            <Button disabled={deleting} onClick={() => void confirm()} variant="danger">
              {deleting ? "删除中…" : "删除配置"}
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
