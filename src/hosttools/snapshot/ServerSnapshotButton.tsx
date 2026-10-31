import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalSession } from "../../models";
import type { ServerSnapshot, ServerSnapshotTarget } from "../../models/serverSnapshot";
import { cancelServerStatusSnapshot, serverStatusSnapshot, serverStatusSnapshotTarget } from "../../services/hostToolsService";
import { Icon } from "../../ui/Icon";
import { formatSnapshot, parseSnapshot } from "./formatSnapshot";
import { ServerSnapshotReport } from "./ServerSnapshotReport";

const REFRESH_OPTIONS = [
  { value: "0", label: "关闭" },
  { value: "5", label: "每 5 秒" },
  { value: "10", label: "每 10 秒" },
  { value: "15", label: "每 15 秒" },
];

/** Shared by the main and detached terminal toolbars, including split panes. */
export function ServerSnapshotButton({ session }: { session: TerminalSession | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const target = useRef<TerminalSession | null>(null);
  const running = useRef(false);
  const pinned = useRef<ServerSnapshotTarget | null>(null);
  const cancelInFlight = useRef(false);
  const [captureTarget, setCaptureTarget] = useState<ServerSnapshotTarget | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [data, setData] = useState<ServerSnapshot | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [view, setView] = useState<"visual" | "text">("visual");
  const collect = useCallback(async (selected: TerminalSession | null, open = true) => {
    if (!selected || running.current) return;
    running.current = true;
    target.current = selected;
    setBusy(true);
    setError("");
    setCopyStatus("");
    if (open) {
      pinned.current = null;
      setCaptureTarget(null);
      setData(null);
      setText("");
      setView("visual");
      dialog.current?.showModal();
      setIsOpen(true);
    }
    try {
      const resolved = await serverStatusSnapshotTarget(selected.id);
      if (pinned.current && pinned.current.identity !== resolved.identity) {
        setRefreshInterval(0);
        throw new Error("目标资产已变化，自动刷新已停止；请关闭报告并重新采集。");
      }
      pinned.current = resolved;
      setCaptureTarget(resolved);
      if (!resolved.ready) throw new Error(resolved.reason || "目标终端尚未准备好");
      if (!dialog.current?.open) return;
      const result = await serverStatusSnapshot(selected.id, resolved.identity);
      const collectedAt = new Date().toLocaleString();
      setData(parseSnapshot(result, collectedAt));
      setText(formatSnapshot(result, collectedAt));
    } catch (cause) {
      if (pinned.current?.source === "terminal") setRefreshInterval(0);
      setError(`采集失败：${cause instanceof Error ? cause.message : "请稍后重试"}`);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!isOpen || refreshInterval === 0) return;
    const timer = window.setInterval(() => {
      // close() changes the native open flag before React receives onClose.
      // collect's shared guard skips ticks while manual/automatic work is busy.
      if (dialog.current?.open) void collect(target.current, false);
    }, refreshInterval * 1000);
    return () => window.clearInterval(timer);
  }, [collect, isOpen, refreshInterval]);

  async function cancelCapture() {
    const current = target.current;
    const location = pinned.current;
    if (cancelInFlight.current || !running.current || !current || location?.source !== "terminal") return;
    cancelInFlight.current = true;
    setRefreshInterval(0);
    setCancelling(true);
    try {
      await cancelServerStatusSnapshot(current.id, location.identity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消采集失败，请在终端按 Ctrl+C。");
    } finally { cancelInFlight.current = false; setCancelling(false); }
  }
  function closeReport() {
    setIsOpen(false);
    void cancelCapture();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("已复制文本快照");
    } catch {
      setView("text");
      setCopyStatus("复制失败，可在文本视图中选择并复制");
    }
  }
  return <>
    <button aria-label="服务器状态快照" className="tab-action"
      disabled={session?.kind !== "ssh" || session.status !== "connected" || busy}
      onClick={() => void collect(session)} title="服务器状态快照（只读；JumpServer 已选资产使用当前终端）" type="button">
      <Icon name="gauge" height="15" width="15" />
    </button>
    <dialog className="server-snapshot" ref={dialog} aria-labelledby="server-snapshot-title" onClose={closeReport} onCancel={closeReport}>
      <header className="server-snapshot__header">
        <strong id="server-snapshot-title">服务器状态快照 · {captureTarget?.label || target.current?.title}</strong>
        <span className="server-snapshot__spacer" />
        <label className="snapshot-auto-refresh" title="上一轮采集未完成时跳过本次自动刷新">
          <span>自动刷新</span>
          <select aria-label="快照自动刷新频率" value={refreshInterval} onChange={(event) => setRefreshInterval(Number(event.currentTarget.value))}>
            {REFRESH_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className="button" disabled={!data} aria-pressed={view === "text"} onClick={() => setView(view === "visual" ? "text" : "visual")} type="button">{view === "visual" ? "文本视图" : "图表视图"}</button>
        <button className="button" disabled={busy || !text} type="button" onClick={() => void copy()}>复制文本</button>
        <button className="button" disabled={busy} onClick={() => void collect(target.current, false)} type="button">刷新</button>
        {busy && captureTarget?.source === "terminal" && <button className="button" disabled={cancelling} onClick={() => void cancelCapture()} type="button">{cancelling ? "取消中…" : "取消采集"}</button>}
        <button autoFocus aria-label="关闭快照" className="button" onClick={() => dialog.current?.close()} type="button">关闭</button>
      </header>
      <div role="status" className="server-snapshot__status">{busy ? "正在并发采集，CPU 采样至少 1 秒…" : copyStatus || (error ? "采集未成功，可重试刷新。" : (captureTarget?.source === "terminal" ? "当前终端资产 · 只读采集 · G / M = GiB / MiB" : "SSH 连接主机 · 只读采集 · G / M = GiB / MiB"))}</div>
      {error && <div className="snapshot-error" role="alert">{error}{data && " 下方保留上次成功采集的快照。"}</div>}
      <div className="server-snapshot__body" aria-busy={busy} tabIndex={0} aria-label="服务器快照报告">
        {data ? view === "visual" ? <ServerSnapshotReport data={data} /> : <pre className="server-snapshot__text">{text}</pre>
          : <p className="snapshot-empty">{busy ? "正在读取系统、CPU、内存、磁盘与网络数据…" : "未获取到快照数据"}</p>}
      </div>
    </dialog>
  </>;
}
