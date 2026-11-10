import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

/** Left-sidebar selectors. */
export type ActivityId = "sessions" | "connections" | "sftp" | "s3" | "artifactory";
/** Right-panel selectors. */
export type RightPanelId = "assistant" | "hosttools";
/** Configurable icons shown in the left activity rail. */
export type NavigationIconId = ActivityId | "browser" | "assistant" | "newLocalTerminal";

interface ActivityBarProps {
  activeActivity: ActivityId;
  visibleNavigationIcons: readonly NavigationIconId[];
  onSelectActivity: (activity: ActivityId) => void;
  sidebarCollapsed: boolean;
  rightPanel: RightPanelId | null;
  onToggleRightPanel: (panel: RightPanelId) => void;
  onNewLocalTerminal: () => void;
  onOpenSettings: () => void;
  onOpenBrowser: () => void;
}

const ACTIVITIES: { id: ActivityId; label: string; icon: IconName }[] = [
  { id: "sessions", label: "会话", icon: "sessions" },
  { id: "connections", label: "连接管理", icon: "connections" },
  { id: "sftp", label: "SFTP", icon: "folder" },
  { id: "s3", label: "S3 对象浏览器", icon: "bucket" },
  { id: "artifactory", label: "Artifactory", icon: "database" },
];

export function ActivityBar({
  activeActivity,
  visibleNavigationIcons,
  onSelectActivity,
  sidebarCollapsed,
  rightPanel,
  onToggleRightPanel,
  onNewLocalTerminal,
  onOpenSettings,
  onOpenBrowser,
}: ActivityBarProps) {
  const visibleActivities = ACTIVITIES.filter((activity) => visibleNavigationIcons.includes(activity.id));
  const showAssistant = visibleNavigationIcons.includes("assistant");
  const showNewLocalTerminal = visibleNavigationIcons.includes("newLocalTerminal");

  return (
    <nav className="activity-bar is-glass-chrome" aria-label="主导航">
      <div className="activity-bar__top">
        {visibleActivities.map((activity) => {
          const expanded = activeActivity === activity.id
            && (activity.id === "connections" || !sidebarCollapsed);
          return (
            <IconButton
              key={activity.id}
              active={expanded}
              aria-expanded={expanded}
              label={activity.label}
              onClick={() => onSelectActivity(activity.id)}
            >
              <Icon name={activity.icon} />
            </IconButton>
          );
        })}
        {visibleNavigationIcons.includes("browser") ? (
          <IconButton label="打开浏览器" onClick={onOpenBrowser}><Icon name="globe" /></IconButton>
        ) : null}
        {showAssistant && visibleActivities.length > 0 ? <div className="activity-bar__divider" /> : null}
        {showAssistant ? (
          <IconButton
            active={rightPanel === "assistant"}
            aria-expanded={rightPanel === "assistant"}
            label="AI 助手"
            onClick={() => onToggleRightPanel("assistant")}
          >
            <Icon name="bot" />
          </IconButton>
        ) : null}
      </div>
      <div className="activity-bar__bottom">
        {showNewLocalTerminal ? (
          <IconButton label="新建本地终端" onClick={onNewLocalTerminal}>
            <Icon name="terminalTool" />
          </IconButton>
        ) : null}
        <IconButton label="设置" onClick={onOpenSettings}>
          <Icon name="settings" />
        </IconButton>
      </div>
    </nav>
  );
}
