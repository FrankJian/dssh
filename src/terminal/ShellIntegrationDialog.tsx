import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import { enableShellIntegration, prepareShellIntegration, type ShellIntegrationApproval, type ShellIntegrationShell } from "../services/sshSessionService";
import { commandOutputTracker } from "./commandOutputStore";

export function ShellIntegrationDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [shell, setShell] = useState<ShellIntegrationShell>("bash");
  const [approval, setApproval] = useState<ShellIntegrationApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const tracker = useRef(commandOutputTracker(sessionId));
  useEffect(() => {
    let active = true;
    void prepareShellIntegration(sessionId).then(value => { if (active) setApproval(value); })
      .catch(() => { if (active) setError("请返回已连接普通 SSH 终端的空白命令提示符，再重新打开此窗口。"); });
    return () => { active = false; };
  }, [sessionId]);

  async function confirm() {
    if (!approval || submitting.current) return;
    const target = tracker.current;
    if (!target || commandOutputTracker(sessionId) !== target) { setError("终端已变化，请关闭此窗口后重新确认。"); return; }
    submitting.current = true; setBusy(true); setError(null);
    target.beginIntegration();
    try {
      await enableShellIntegration(approval, shell);
      onClose();
    } catch {
      target.failIntegration("终端状态已变化或发送失败，请重新检查提示符并确认。");
      setError("未能发送启用脚本。请检查连接和提示符，关闭后重新确认。");
    } finally { submitting.current = false; setBusy(false); }
  }

  return <Dialog title="启用本次会话的命令识别" onClose={onClose} busy={busy} initialFocusSelector="[data-integration-cancel]" footer={<>
    <Button data-integration-cancel disabled={busy} onClick={onClose}>取消</Button>
    <Button variant="primary" disabled={!approval || busy || !!error} onClick={() => void confirm()}>{busy ? "正在发送…" : "确认启用"}</Button>
  </>}>
    <div className="command-integration-dialog">
      {approval && <strong>{approval.label}</strong>}
      <p>请先返回空白命令提示符，并选择当前会话使用的 shell。</p>
      <SegmentedControl label="当前 shell" value={shell} onChange={setShell} options={[
        {value: "bash", label: "Bash", disabled: busy}, {value: "zsh", label: "Zsh", disabled: busy},
      ]} />
      <p>确认后会向此终端发送临时集成脚本，仅在当前 shell 中生效，关闭会话即结束；不会写入配置文件。</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
