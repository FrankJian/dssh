import type { HostKeyPromptEvent } from "../services/sshSessionService";
import { Icon } from "../ui/Icon";

interface HostKeyPromptProps {
  prompt: HostKeyPromptEvent;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Trust-on-first-use prompt: shown the first time a host's key fingerprint is
 * seen. Accepting stores the fingerprint so future connects are silent; a later
 * mismatch is rejected automatically (see HostKeyVerifier).
 */
export function HostKeyPrompt({ prompt, onAccept, onReject }: HostKeyPromptProps) {
  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="hostkey-dialog" role="dialog" aria-label="验证主机密钥">
        <header className="hostkey-dialog__header">
          <Icon name="shield" height="16" width="16" />
          <h2>验证主机密钥</h2>
        </header>
        <div className="hostkey-dialog__body">
          <p className="hostkey-dialog__intro">
            首次连接到 <strong>{prompt.host}:{prompt.port}</strong>。请核对下面的密钥指纹与服务器的实际指纹是否一致：
          </p>
          <code className="hostkey-dialog__fingerprint">{prompt.fingerprint}</code>
          <p className="hostkey-dialog__warning">
            只有在确认指纹无误时才应信任。指纹不符可能意味着中间人攻击。信任后该指纹会被记住，下次连接不再询问。
          </p>
        </div>
        <div className="hostkey-dialog__actions">
          <button className="button" onClick={onReject} type="button">
            拒绝
          </button>
          <button className="button button--primary" onClick={onAccept} type="button">
            信任并继续
          </button>
        </div>
      </section>
    </div>
  );
}
