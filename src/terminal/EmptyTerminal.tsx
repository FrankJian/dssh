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
  const isHome = mode === "home";
  const isTerminalHome = mode === "terminal";
  const title = isHome
    ? "管理你的 SSH 连接"
    : isTerminalHome
      ? "最近连接"
      : "终端会话已启动";
  const description = isHome
    ? "在左侧 SSH 配置中创建连接，或稍后直接进入本地终端。所有配置会保存在本地。"
    : isTerminalHome
      ? recentProfiles.length > 0
        ? "点击连接即可打开终端。"
        : "还没有最近连接记录。连接过的服务器会显示在这里。"
      : "每个标签页都是独立的终端会话。切换标签不会中断连接，关闭标签会结束对应会话。";

  return (
    <div className={`terminal-empty terminal-empty--${mode}`}>
      <div className="terminal-empty__panel">
        <span className="terminal-empty__eyebrow">{isHome ? "安全连接" : "终端"}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {isTerminalHome && onConnectProfile && recentProfiles.length > 0 ? (
          <div className="terminal-empty__recent-list" aria-label="最近连接">
            {recentProfiles.map((profile) => (
              <button
                className="terminal-empty__recent-item"
                key={profile.id}
                onClick={() => onConnectProfile(profile)}
                type="button"
              >
                <span className="terminal-empty__recent-icon">
                  <Icon name={profileIconName(profile.icon)} height="18" width="18" />
                </span>
                <span className="terminal-empty__recent-details">
                  <span className="terminal-empty__recent-name">{profile.name}</span>
                  <span className="terminal-empty__recent-host">{profile.username}@{profile.host}:{profile.port}</span>
                </span>
                <Icon name="chevron-right" height="16" width="16" />
              </button>
            ))}
          </div>
        ) : null}
        <div className="terminal-empty__actions">
          {isHome ? (
            <>
              <Button onClick={onCreateProfile} variant="primary">
                新建 SSH 配置
              </Button>
              <Button onClick={onStartLocalSession} variant="ghost">
                稍后导入
              </Button>
            </>
          ) : null}
          {isTerminalHome && onOpenConnections ? (
            <Button onClick={onOpenConnections} variant={recentProfiles.length > 0 ? "ghost" : "primary"}>
              查看全部连接
            </Button>
          ) : null}
          {isTerminalHome && !onOpenConnections ? (
            <Button onClick={onStartLocalSession} variant="primary">
              打开本地终端
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
