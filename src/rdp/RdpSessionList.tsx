import { useState } from "react";
import type { RdpSession } from "../models/rdp";
import { Icon } from "../ui/Icon";
const labels: Record<RdpSession["status"], string> = { starting: "正在启动", connecting: "正在连接", connected: "已连接", disconnecting: "正在断开", closed: "已断开", failed: "连接失败" };
export function RdpSessionList({ sessions, onFocus, onClose, onReconnect }: { sessions: RdpSession[]; onFocus: (id: string) => void; onClose: (id: string) => void; onReconnect: (profileId: string) => void }) {
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  if (!sessions.length) return null;
  return <section className="rdp-sessions" aria-label="远程桌面会话">
    <h3 className="session-tree__eyebrow rdp-sessions__heading">远程桌面<span className="session-node__count" aria-label={`${sessions.length} 个远程桌面会话`}>{sessions.length}</span></h3>
    {sessions.map((s) => {
      const ended = s.status === "closed" || s.status === "failed";
      const expanded = expandedSessions[s.id] ?? s.status === "failed";
      const contentId = `rdp-session-${s.id}`;
      return <div className="session-node rdp-session" key={s.id}>
        <div className="session-node__row">
          <button className="session-node__disclosure" type="button" aria-expanded={expanded} aria-controls={contentId}
            onClick={() => setExpandedSessions((current) => ({ ...current, [s.id]: !expanded }))}>
            <span className="session-node__chevron" data-collapsed={!expanded}><Icon name="chevron-right" height="14" width="14" /></span>
            <span className="session-node__status" data-status={s.status === "starting" ? "connecting" : s.status} />
            <span className="session-node__label">
              <span className="session-node__heading"><span className="session-node__title" title={s.title}>{s.title}</span><Icon className="rdp-session__icon" name="monitor" height="14" width="14" /></span>
              <span className="rdp-session__meta"><span role="status">{labels[s.status]}</span>
                {s.certificateVerificationSkipped ? <span className="rdp-session__trust" title="未验证服务器证书，无法确认服务器身份"><Icon name="shield" height="12" width="12" />未验证证书</span> : null}
              </span>
            </span>
          </button>
        </div>
        <div id={contentId} className="session-node__children" hidden={!expanded}>
          {ended ? <button className="session-child" type="button" onClick={() => onReconnect(s.profileId)}><Icon name="refresh" height="15" width="15" /><span>重新连接</span></button> : <>
            <button className="session-child" type="button" onClick={() => onFocus(s.id)} disabled={s.status !== "connected"}><Icon name="externalWindow" height="15" width="15" /><span>打开窗口</span></button>
            <button className="session-child session-child--danger" type="button" onClick={() => onClose(s.id)} disabled={s.status === "disconnecting"}><Icon name="unplug" height="15" width="15" /><span>断开连接</span></button>
          </>}
          {s.message ? <p className="rdp-session__message" role="alert">{s.message}</p> : null}
        </div>
      </div>;
    })}
  </section>;
}
