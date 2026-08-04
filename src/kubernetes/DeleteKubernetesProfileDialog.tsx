import { useState } from "react";
import type { KubernetesProfile } from "../models";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface Props {
  profile: KubernetesProfile;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteKubernetesProfileDialog({ profile, onClose, onConfirm }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除 Kubernetes 配置失败。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="kubernetes-delete-dialog" aria-label="确认删除 Kubernetes 配置">
        <header className="profile-editor__topbar">
          <h2>确认删除配置</h2>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="kubernetes-delete-dialog__body">
          <p>确定删除 Kubernetes 配置“{profile.name}”吗？</p>
          <p className="kubernetes-delete-dialog__warning">此操作无法撤销。</p>
          {error ? <div className="form-errors">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={deleting} onClick={onClose} variant="secondary">取消</Button>
            <Button className="kubernetes-delete-dialog__confirm" disabled={deleting} onClick={() => void confirm()} variant="primary">
              {deleting ? "删除中…" : "删除配置"}
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
