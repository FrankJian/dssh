import { useState } from "react";
import type { TerminalTransferConflictEvent } from "../services/sshSessionService";
import { toast } from "../ui/ToastHost";
import { Button } from "../ui/Button";
import { useDialogFocus } from "../ui/useDialogFocus";

interface TerminalTransferConflictDialogProps {
  conflict: TerminalTransferConflictEvent;
  onResolve: (conflict: TerminalTransferConflictEvent, overwrite: boolean) => Promise<void>;
}

export function TerminalTransferConflictDialog({ conflict, onResolve }: TerminalTransferConflictDialogProps) {
  const dialogRef = useDialogFocus();
  const [busy, setBusy] = useState(false);

  async function resolve(overwrite: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await onResolve(conflict, overwrite);
    } catch (error) {
      toast(error instanceof Error ? error.message : "无法处理同名文件。", "error");
      setBusy(false);
    }
  }

  return (
    <div className="profile-editor-backdrop terminal-transfer-conflict-backdrop" role="presentation">
      <section
        ref={dialogRef}
        aria-describedby="zmodem-conflict-description"
        aria-label="处理同名下载文件"
        aria-modal="true"
        className="hostkey-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            void resolve(false);
          }
        }}
        role="dialog"
      >
        <header className="hostkey-dialog__header"><h2>本地已有同名文件</h2></header>
        <div className="hostkey-dialog__body">
          <p className="hostkey-dialog__intro" id="zmodem-conflict-description">
            通过 sz 下载的文件与本地文件同名。请选择覆盖或跳过；默认跳过。
          </p>
          <code className="hostkey-dialog__fingerprint">{conflict.fileName}</code>
          <p className="hostkey-dialog__warning">
            选择覆盖后会先完整下载到临时文件，成功后才替换原文件。下载大小：{formatFileSize(conflict.fileSize)}。
          </p>
        </div>
        <div className="hostkey-dialog__actions">
          <Button autoFocus disabled={busy} onClick={() => void resolve(false)} variant="secondary">
            跳过
          </Button>
          <Button disabled={busy} onClick={() => void resolve(true)} variant="danger">
            覆盖
          </Button>
        </div>
      </section>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}
