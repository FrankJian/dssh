import { Button } from "../ui/Button";

interface EmptyTerminalProps {
  mode: "home" | "session" | "terminal";
  onCreateProfile: () => void;
  onStartLocalSession?: () => void;
}

export function EmptyTerminal({ mode, onCreateProfile, onStartLocalSession }: EmptyTerminalProps) {
  const isHome = mode === "home";
  const isTerminalHome = mode === "terminal";
  const title = isHome
    ? "管理你的 SSH 连接"
    : isTerminalHome
      ? "打开本地终端"
      : "终端会话已启动";
  const description = isHome
    ? "在左侧 SSH 配置中创建连接，或稍后直接进入本地终端。所有配置会保存在本地。"
    : isTerminalHome
      ? "当前没有活动会话。你可以打开本地终端，或从左侧 SSH 配置启动远程会话。"
      : "每个标签页都是独立的终端会话。切换标签不会中断连接，关闭标签会结束对应会话。";

  return (
    <div className={`terminal-empty terminal-empty--${mode}`}>
      <div className="terminal-empty__panel">
        <span className="terminal-empty__eyebrow">{isHome ? "安全连接" : "终端"}</span>
        <h1>{title}</h1>
        <p>{description}</p>
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
          {isTerminalHome ? (
            <Button onClick={onStartLocalSession} variant="primary">
              打开本地终端
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
