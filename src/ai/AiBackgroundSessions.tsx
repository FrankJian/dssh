import { useEffect, useState } from "react";
import type { TerminalSession } from "../models";
import { closeAiBackgroundSession, listAiBackgroundSessions, takeOverAiSession } from "../services/aiService";
import { Button } from "../ui/Button";

const STATUS: Record<TerminalSession["status"], string> = {
  connecting: "连接中", connected: "已连接", reconnecting: "重连中", disconnecting: "断开中",
  disconnected: "已断开", exited: "已退出", failed: "连接失败",
};

export function AiBackgroundSessions({ conversationId, onTakeOver }: {
  conversationId: string;
  onTakeOver?: (session: TerminalSession) => Promise<void>;
}) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSessions([]); setError(null);
    async function refresh() {
      try {
        const items = await listAiBackgroundSessions(conversationId);
        if (!cancelled) setSessions(items);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "后台会话读取失败。");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [conversationId]);

  async function act(session: TerminalSession, takeOver: boolean) {
    if (busy) return;
    if (!takeOver && !window.confirm(`关闭后台会话“${session.title}”？这可能中断正在运行的任务。`)) return;
    setBusy(true); setError(null);
    try {
      if (takeOver) {
        const visible = await takeOverAiSession(conversationId, session.id);
        await onTakeOver?.(visible);
      } else await closeAiBackgroundSession(conversationId, session.id);
      setSessions((items) => items.filter((item) => item.id !== session.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "后台会话操作失败。");
    } finally { setBusy(false); }
  }

  if (!sessions.length && !error) return null;
  return <div className="ai-background-sessions" aria-label="AI 后台会话">
    {sessions.length ? <details>
      <summary>后台会话 · {sessions.length}</summary>
      {sessions.map((session) => <div className="ai-background-sessions__row" key={session.id}>
        <span title={session.id}>{session.title}<small>{STATUS[session.status]}</small></span>
        {onTakeOver ? <Button variant="ghost" disabled={busy} onClick={() => void act(session, true)} title="显示原终端并停止 AI 输入">接管</Button> : null}
        <Button variant="ghost" disabled={busy} onClick={() => void act(session, false)}>关闭</Button>
      </div>)}
    </details> : null}
    {error ? <div className="ai-provider__error" role="alert">{error}</div> : null}
  </div>;
}
