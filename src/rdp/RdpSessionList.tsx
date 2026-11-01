import type { RdpSession } from "../models/rdp";
import { Icon } from "../ui/Icon";
const labels: Record<RdpSession["status"], string> = { starting: "正在启动", connecting: "正在连接", connected: "已连接", disconnecting: "正在断开", closed: "已断开", failed: "连接失败" };
export function RdpSessionList({ sessions, onFocus, onClose, onReconnect }: { sessions: RdpSession[]; onFocus: (id: string) => void; onClose: (id: string) => void; onReconnect: (profileId: string) => void }) {
  if (!sessions.length) return null;
  return <section className="rdp-sessions" aria-label="远程桌面会话"><h3><Icon name="monitor" height="14" width="14" />远程桌面</h3>
    {sessions.map((s) => {
      const ended = s.status === "closed" || s.status === "failed";
      return <div className="rdp-sessions__item" key={s.id}>
        <div className="rdp-sessions__title"><span title={s.title}>{s.title}</span><span role="status">{labels[s.status]}</span></div>
        {s.certificateVerificationSkipped ? <p className="rdp-security-warning">未验证服务器证书</p> : null}
        {s.message ? <p role="alert">{s.message}</p> : null}
        <div className="rdp-sessions__actions">{ended ? <button type="button" onClick={() => onReconnect(s.profileId)}>重新连接</button> : <>
          <button type="button" onClick={() => onFocus(s.id)} disabled={s.status !== "connected"}>打开窗口</button>
          <button type="button" onClick={() => onClose(s.id)} disabled={s.status === "disconnecting"}>断开</button></>}
        </div>
      </div>;
    })}
  </section>;
}
