import { smbConnectionAddress } from "../models/smb";
import { ConnectionAddress } from "../ssh/ConnectionAddress";
import { connectionTypeForProfile, connectionTypeLabel, isJumpServerProfile, isRdpProfile, isSmbProfile, type ConnectionProfile } from "../ssh/connectionTypes";
import { profileIconName } from "../ssh/profileIcons";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface EmptyTerminalProps {
  mode: "home" | "session" | "terminal";
  onCreateProfile: () => void;
  onStartLocalSession?: () => void;
  recentProfiles?: ConnectionProfile[];
  onConnectProfile?: (profile: ConnectionProfile) => void;
  onOpenConnections?: () => void;
}

export function EmptyTerminal({
  mode,
  onCreateProfile,
  onStartLocalSession,
  recentProfiles = [],
  onConnectProfile,
  onOpenConnections,
}: EmptyTerminalProps) {
  if (mode === "terminal") {
    return (
      <div className="terminal-empty terminal-empty--terminal">
        <section className="terminal-empty__panel" aria-label="最近连接">
          <header className="terminal-empty__recent-header">
            <div className="terminal-empty__recent-heading">
              <div className="terminal-empty__recent-title"><h1><Icon name="clock" height="16" width="16" />最近连接</h1>
                {recentProfiles.length > 0 ? <span className="terminal-empty__recent-count">{recentProfiles.length}</span> : null}</div>
              <p>继续最近的工作，快速回到你的服务器。</p>
            </div>
            {onOpenConnections ? (
              <Button className="terminal-empty__all" onClick={onOpenConnections} variant="ghost">
                全部连接<Icon name="arrowRight" height="14" width="14" />
              </Button>
            ) : null}
          </header>
          {onConnectProfile && recentProfiles.length > 0 ? (
            <ul className="terminal-empty__recent-list">
              {recentProfiles.map((profile) => {
                const host = profile.host.includes(":") && !profile.host.startsWith("[") ? `[${profile.host}]` : profile.host;
                const address = isJumpServerProfile(profile) ? profile.coreUrl : isSmbProfile(profile) ? smbConnectionAddress(profile) : `${profile.username}@${host}:${profile.port}`;
                return (
                  <li key={profile.id}>
                    <button
                      className="terminal-empty__recent-item"
                      onClick={() => onConnectProfile(profile)}
                      title={`${profile.name}\n${address}`}
                      aria-label={`${connectionTypeForProfile(profile) === "sftp" ? "打开 SFTP" : "连接"} ${profile.name}，${address}`}
                      type="button"
                    >
                      <span className="terminal-empty__recent-card-head">
                        <span className="terminal-empty__recent-icon">
                          <Icon name={isJumpServerProfile(profile) ? "stackedHexagon" : isRdpProfile(profile) ? "monitor" : isSmbProfile(profile) ? "folder" : profileIconName(profile.icon)} height="18" width="18" />
                        </span>
                        <span className="terminal-empty__recent-name">{profile.name}</span>
                        <span className="terminal-empty__recent-type">{connectionTypeLabel(connectionTypeForProfile(profile))}</span>
                      </span>
                      <span className="terminal-empty__recent-details">
                        <ConnectionAddress address={address} focusable={false} />
                        <span className="terminal-empty__recent-folder" title={profile.folder || "根目录"}>
                          <Icon name="folder" height="12" width="12" /><span>{profile.folder || "根目录"}</span>
                        </span>
                        {isRdpProfile(profile) && profile.skipCertificateVerification ? <span className="conn-card__warning">
                          <Icon name="shield" height="12" width="12" />未验证证书
                        </span> : null}
                      </span>
                      <span className="terminal-empty__recent-card-footer">
                        <span className="terminal-empty__recent-tags">
                          {profile.tags.slice(0, 2).map(tag => <span className="conn-card__tag" key={tag} title={tag}>{tag}</span>)}
                          {profile.tags.length > 2 ? <span className="conn-card__tag conn-card__tag--overflow">+{profile.tags.length - 2}</span> : null}
                        </span>
                        <span className="terminal-empty__recent-open">{isJumpServerProfile(profile) ? "打开资产" : connectionTypeForProfile(profile) === "sftp" ? "打开 SFTP" : "连接"}<Icon name="arrowRight" height="14" width="14" /></span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="terminal-empty__recent-placeholder">连接过的服务器会显示在这里。</p>}
          <div className="terminal-empty__actions">
            <Button onClick={onCreateProfile}><Icon name="plus" height="15" width="15" />新建连接</Button>
            {onStartLocalSession ? (
              <Button onClick={onStartLocalSession} variant="ghost"><Icon name="terminalTool" height="15" width="15" />本地终端</Button>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  const isHome = mode === "home";
  return (
    <div className={`terminal-empty terminal-empty--${mode}`}>
      <div className="terminal-empty__panel">
        <span className="terminal-empty__eyebrow">{isHome ? "安全连接" : "终端"}</span>
        <h1>{isHome ? "管理你的 SSH 连接" : "终端会话已启动"}</h1>
        <p>{isHome
          ? "在左侧 SSH 配置中创建连接，或稍后直接进入本地终端。所有配置会保存在本地。"
          : "每个标签页都是独立的终端会话。切换标签不会中断连接，关闭标签会结束对应会话。"}</p>
        {isHome ? (
          <div className="terminal-empty__actions">
            <Button onClick={onCreateProfile} variant="primary">新建 SSH 配置</Button>
            <Button onClick={onStartLocalSession} variant="ghost">稍后导入</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
