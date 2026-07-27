import { useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface Props {
  folderCount: number;
  itemCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteS3ObjectsDialog({
  folderCount,
  itemCount,
  onClose,
  onConfirm,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除 S3 对象失败。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="s3-delete-dialog" aria-label="确认删除 S3 对象">
        <header className="profile-editor__topbar">
          <h2>确认删除</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="s3-delete-dialog__body">
          <p>确定要删除选中的 {itemCount} 个项目吗？此操作无法撤销。</p>
          {folderCount ? (
            <p className="s3-delete-dialog__warning">
              其中包含 {folderCount} 个文件夹，其下的全部对象也会被递归删除。
            </p>
          ) : null}
          {error ? <div className="form-errors">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={deleting} onClick={onClose} variant="ghost">取消</Button>
            <Button className="s3-delete-dialog__confirm" disabled={deleting} onClick={() => void confirm()} variant="primary">
              {deleting ? "删除中..." : "删除"}
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
