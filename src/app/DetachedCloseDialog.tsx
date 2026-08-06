import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface DetachedCloseDialogProps {
  sessionCount: number;
  onCancel: () => void;
  onReturn: () => void;
  onCloseSessions: () => void;
}

/**
 * Closing a detached window is ambiguous: it can either hand the terminals back
 * to the main window or end them. Neither reading is wrong, so ask rather than
 * pick one — silently restoring looks like the sessions were closed, and
 * silently closing would kill work behind a window button.
 */
export function DetachedCloseDialog({
  sessionCount,
  onCancel,
  onReturn,
  onCloseSessions,
}: DetachedCloseDialogProps) {
  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section aria-label="关闭独立终端窗口" className="detached-close-dialog">
        <header className="profile-editor__topbar">
          <h2>关闭独立窗口</h2>
          <button aria-label="取消" className="icon-button" onClick={onCancel} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="detached-close-dialog__body">
          <p>这个窗口里有 {sessionCount} 个终端会话。要把它们移回主窗口，还是直接结束？</p>
          <p className="detached-close-dialog__warning">
            结束会话无法撤销，正在运行的命令会被中断。
          </p>
          <footer className="s3-dialog-actions">
            <Button onClick={onCancel} variant="secondary">
              取消
            </Button>
            <Button
              className="detached-close-dialog__danger"
              onClick={onCloseSessions}
              variant="secondary"
            >
              关闭会话
            </Button>
            <Button onClick={onReturn} variant="primary">
              移回主窗口
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
