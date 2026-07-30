import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

/** Left-sidebar selectors. */
export type ActivityId = "sessions" | "connections" | "s3";
/** Right-panel selectors. */
export type RightPanelId = "assistant" | "hosttools";
/** Configurable icons shown in the left activity rail. */
export type NavigationIconId = ActivityId | "assistant" | "newLocalTerminal";

interface ActivityBarProps {
  activeActivity: ActivityId;
  visibleNavigationIcons: readonly NavigationIconId[];
  onSelectActivity: (activity: ActivityId) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  rightPanel: RightPanelId | null;
  onToggleRightPanel: (panel: RightPanelId) => void;
  onNewLocalTerminal: () => void;
  onOpenSettings: () => void;
}

const ACTIVITIES: { id: ActivityId; label: string; icon: IconName }[] = [
  { id: "sessions", label: "会话", icon: "sessions" },
  { id: "connections", label: "连接管理", icon: "connections" },
  { id: "s3", label: "S3 对象浏览器", icon: "bucket" },
];

export function ActivityBar({
  activeActivity,
  visibleNavigationIcons,
  onSelectActivity,
  sidebarCollapsed,
  onToggleSidebar,
  rightPanel,
  onToggleRightPanel,
  onNewLocalTerminal,
  onOpenSettings,
}: ActivityBarProps) {
  const visibleActivities = ACTIVITIES.filter((activity) => visibleNavigationIcons.includes(activity.id));
  const showAssistant = visibleNavigationIcons.includes("assistant");
  const showNewLocalTerminal = visibleNavigationIcons.includes("newLocalTerminal");

  return (
    <nav className="activity-bar" aria-label="主导航">
      <div className="activity-bar__top">
        <IconButton
          active={!sidebarCollapsed}
          className="activity-toggle"
          label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
          onClick={onToggleSidebar}
        >
          <Icon name="panelLeft" />
        </IconButton>
        <div className="activity-bar__divider" />
        {visibleActivities.map((activity) => (
          <IconButton
            key={activity.id}
            active={activeActivity === activity.id}
            label={activity.label}
            onClick={() => onSelectActivity(activity.id)}
          >
            <Icon name={activity.icon} />
          </IconButton>
        ))}
        {showAssistant && visibleActivities.length > 0 ? <div className="activity-bar__divider" /> : null}
        {showAssistant ? (
          <IconButton
            active={rightPanel === "assistant"}
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
