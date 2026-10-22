import type { TerminalTransferStatusEvent } from "../services/sshSessionService";

interface TerminalTransferNoticeProps {
  transfers: TerminalTransferStatusEvent[];
  onCancel: (transfer: TerminalTransferStatusEvent) => void;
}

export function TerminalTransferNotice({ transfers, onCancel }: TerminalTransferNoticeProps) {
  if (transfers.length === 0) return null;

  return (
    <div aria-live="polite" className="terminal-transfer-notices">
      {transfers.map((transfer) => {
        const isActive = transfer.state === "transferring" || transfer.state === "awaitingSelection" || transfer.state === "awaitingConflict";
        const percentage = transfer.total && transfer.total > 0
          ? Math.min(100, Math.round((transfer.transferred / transfer.total) * 100))
          : 0;
        const title = transfer.state === "awaitingConflict"
          ? "等待处理同名文件"
          : transfer.state === "awaitingSelection"
          ? transfer.direction === "download" ? "等待选择保存目录" : "等待选择上传文件"
          : transfer.state === "transferring"
            ? transfer.direction === "download" ? "正在通过 sz 下载" : "正在通过 rz 上传"
            : transfer.state === "completed"
              ? (transfer.message ? "传输结束（含提示）" : "文件传输完成")
              : transfer.state === "cancelled"
                ? "文件传输已取消"
                : "文件传输失败";

        return (
          <section
            className={`terminal-transfer-notice${transfer.state === "failed" ? " is-error" : ""}`}
            key={transfer.detectionId}
          >
            <div className="terminal-transfer-notice__heading">
              <span>{title}</span>
              {isActive ? (
                <button onClick={() => onCancel(transfer)} type="button">
                  取消
                </button>
              ) : null}
            </div>
            {transfer.fileName ? (
              <div className="terminal-transfer-notice__filename" title={transfer.fileName}>
                {transfer.fileName}
                {transfer.fileIndex && transfer.fileCount
                  ? ` (${transfer.fileIndex}/${transfer.fileCount})`
                  : ""}
              </div>
            ) : null}
            {transfer.state === "transferring" ? (
              <>
                <progress max={100} value={percentage} />
                <div className="terminal-transfer-notice__progress-label">
                  {percentage}% · {formatBytes(transfer.transferred)}
                  {transfer.total === undefined ? "" : ` / ${formatBytes(transfer.total)}`}
                </div>
              </>
            ) : null}
            {transfer.message ? (
              <div className="terminal-transfer-notice__message">{transfer.message}</div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0] ?? "KiB";
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index] ?? unit;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}
