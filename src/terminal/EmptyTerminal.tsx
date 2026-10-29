import type { SshProfile } from "../models";
import { profileIconName } from "../ssh/profileIcons";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface EmptyTerminalProps {
  mode: "home" | "session" | "terminal";
  onCreateProfile: () => void;
  onStartLocalSession?: () => void;
  recentProfiles?: SshProfile[];
  onConnectProfile?: (profile: SshProfile) => void;
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
            <h1><Icon name="clock" height="16" width="16" />最近连接</h1>
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
                const address = `${profile.username}@${host}:${profile.port}`;
                return (
                  <li key={profile.id}>
                    <button
                      className="terminal-empty__recent-item"
                      onClick={() => onConnectProfile(profile)}
                      title={`${profile.name}\n${address}`}
                      aria-label={`连接 ${profile.name}，${address}`}
                      type="button"
                    >
                      <span className="terminal-empty__recent-icon">
                        <Icon name={profileIconName(profile.icon)} height="18" width="18" />
                      </span>
                      <span className="terminal-empty__recent-details">
                        <span className="terminal-empty__recent-name">{profile.name}</span>
                        <span className="terminal-empty__recent-host">{address}</span>
                      </span>
                      <Icon name="arrowRight" height="15" width="15" />
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
