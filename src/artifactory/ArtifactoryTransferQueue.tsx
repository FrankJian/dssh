import type { ArtifactoryTransfer } from "../services/artifactoryService";
import { Icon } from "../ui/Icon";

type Props = {
  tasks: ArtifactoryTransfer[];
  onCancel: (id: string) => void;
  onRetry: (task: ArtifactoryTransfer) => void;
  onClear: () => void;
  onClose: () => void;
};

const statusLabel: Record<ArtifactoryTransfer["status"], string> = {
  queued: "等待中", running: "传输中", completed: "已完成", failed: "失败", cancelled: "已取消",
};
const kindLabel: Record<ArtifactoryTransfer["kind"], string> = {
  upload: "上传", download: "下载", archive: "目录下载",
};

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

export function ArtifactoryTransferQueue({ tasks, onCancel, onRetry, onClear, onClose }: Props) {
  return <section className="artifactory-queue" aria-label="Artifactory 传输队列">
    <header className="artifactory-queue__head"><strong>传输队列</strong><span>{tasks.length} 个任务</span><div className="artifactory-queue__head-actions"><button disabled={!tasks.some((task) => ["completed", "failed", "cancelled"].includes(task.status))} onClick={onClear} type="button">清除已结束</button><button aria-label="收起传输队列" onClick={onClose} type="button"><Icon name="close" /></button></div></header>
    <div className="artifactory-queue__list">
      {!tasks.length && <p className="artifactory-muted">暂无传输任务</p>}
      {[...tasks].reverse().map((task) => <div className="artifactory-queue__row" key={task.id}>
        <Icon name={task.kind === "upload" ? "upload" : "download"} />
        <div className="artifactory-queue__task"><strong title={task.path}>{task.name}</strong><span>{kindLabel[task.kind]} · {task.repo}/{task.path}</span>{task.error && <small title={task.error}>{task.error}</small>}{task.status === "running" && task.total != null && <progress aria-label={`${task.name} 传输进度`} max={task.total || 1} value={task.transferred} />}</div>
        <span className="artifactory-queue__progress">{task.status === "running" ? `${size(task.transferred)}${task.total == null ? "" : ` / ${size(task.total)}`}` : statusLabel[task.status]}</span>
        {(["queued", "running"].includes(task.status)) && <button aria-label={`取消 ${task.name}`} onClick={() => onCancel(task.id)} type="button">取消</button>}
        {(["failed", "cancelled"].includes(task.status)) && <button aria-label={`重试 ${task.name}`} onClick={() => onRetry(task)} type="button">重试</button>}
      </div>)}
    </div>
  </section>;
}
