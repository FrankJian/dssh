import { useState } from "react";
import type { S3Profile } from "../models";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useDialogFocus } from "../ui/useDialogFocus";

interface Props {
  profile: S3Profile;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteS3ProfileDialog({ profile, onClose, onConfirm }: Props) {
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
      setError(reason instanceof Error ? reason.message : "删除 S3 配置失败。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section ref={dialogRef} className="s3-delete-dialog" role="dialog" aria-modal="true" aria-label="确认删除 S3 配置"
        onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !deleting) { event.stopPropagation(); onClose(); } }}>
        <header className="profile-editor__topbar">
          <h2>确认删除配置</h2>
          <button className="icon-button" aria-label="关闭" disabled={deleting} onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="s3-delete-dialog__body">
          <p>确定删除 S3 配置“{profile.name}”吗？此操作无法撤销。</p>
          <p className="s3-delete-dialog__warning">已打开的该配置标签页也会关闭。</p>
          {error ? <div className="form-errors" role="alert">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={deleting} onClick={onClose} variant="secondary">取消</Button>
            <Button disabled={deleting} onClick={() => void confirm()} variant="danger">
              {deleting ? "删除中..." : "删除配置"}
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
