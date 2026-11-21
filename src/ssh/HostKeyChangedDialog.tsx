import type { HostKeyChangedEvent } from "../services/sshSessionService";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export function HostKeyChangedDialog({ event, onClose }: { event: HostKeyChangedEvent; onClose: () => void }) {
  return <Dialog title="主机密钥已变更" onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    <p className="app-dialog__error" role="alert">连接已被拒绝。请先核对服务器身份，指纹不符可能意味着中间人攻击。</p>
    <dl className="app-dialog__details">
      <div><dt>服务器</dt><dd>{event.host}:{event.port}</dd></div>
      <div><dt>已记录指纹</dt><dd>{event.storedFingerprint}</dd></div>
      <div><dt>本次指纹</dt><dd>{event.presentedFingerprint}</dd></div>
    </dl>
    <p>如果这是预期的变更（例如服务器重装），请核对实际指纹后在 known_hosts 中移除旧记录，再重新连接。</p>
  </Dialog>;
}
