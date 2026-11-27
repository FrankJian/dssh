import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { SIDEBAR_LABELS, type SidebarContext } from "./sidebarDetails";

/** Left-sidebar selectors. */
export type ActivityId = "sessions" | "connections" | "tools" | "sftp" | "s3" | "artifactory";
/** Right-panel selectors. */
export type RightPanelId = "assistant" | "hosttools";
/** Configurable icons shown in the left activity rail. */
export type NavigationIconId = ActivityId | "editor" | "browser" | "assistant" | "newLocalTerminal";

interface ActivityBarProps {
  activeActivity: ActivityId;
  visibleNavigationIcons: readonly NavigationIconId[];
  onSelectActivity: (activity: ActivityId) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar?: () => void;
  sidebarContext?: SidebarContext | null;
  activeNavigation?: NavigationIconId;
  rightPanel: RightPanelId | null;
  onToggleRightPanel: (panel: RightPanelId) => void;
  onNewLocalTerminal: () => void;
  onOpenSettings: () => void;
  onOpenBrowser: () => void;
  onOpenEditor: () => void;
}

const ACTIVITIES: { id: ActivityId; label: string; icon: IconName }[] = [
  { id: "sessions", label: "会话", icon: "sessions" },
  { id: "connections", label: "连接管理", icon: "connections" },
  { id: "tools", label: "工具箱", icon: "toolbox" },
  { id: "sftp", label: "SFTP", icon: "folder" },
  { id: "s3", label: "S3 对象浏览器", icon: "bucket" },
  { id: "artifactory", label: "Artifactory", icon: "database" },
];

export function ActivityBar({
  activeActivity,
  visibleNavigationIcons,
  onSelectActivity,
  sidebarCollapsed,
  onToggleSidebar,
  sidebarContext = activeActivity,
  activeNavigation = activeActivity,
  rightPanel,
  onToggleRightPanel,
  onNewLocalTerminal,
  onOpenSettings,
  onOpenBrowser,
  onOpenEditor,
}: ActivityBarProps) {
  const visibleActivities = ACTIVITIES.filter((activity) => visibleNavigationIcons.includes(activity.id));
  const showAssistant = visibleNavigationIcons.includes("assistant");
  const showNewLocalTerminal = visibleNavigationIcons.includes("newLocalTerminal");

  return (
    <nav className="activity-bar is-glass-chrome" aria-label="主导航">
      <div className="activity-bar__top">
        <div className="activity-bar__details-control">
          <IconButton className="activity-bar__details-toggle" data-sidebar-details-toggle
            label={sidebarContext === null ? "当前页面没有侧边栏详情" : `${sidebarCollapsed ? "展开" : "收起"}侧边栏详情（${SIDEBAR_LABELS[sidebarContext]}）`}
            disabled={sidebarContext === null || !onToggleSidebar}
            active={sidebarContext !== null && !sidebarCollapsed}
            aria-expanded={sidebarContext === null ? undefined : !sidebarCollapsed}
            onClick={onToggleSidebar}>
            <Icon name={sidebarCollapsed ? "panelLeftOpen" : "panelLeftClose"} />
          </IconButton>
        </div>
        {visibleActivities.map((activity) => {
          const selected = activeNavigation === activity.id;
          return (
            <IconButton
              key={activity.id}
              active={selected}
              aria-current={selected ? "page" : undefined}
              label={activity.label}
              onClick={() => onSelectActivity(activity.id)}
            >
              <Icon name={activity.icon} />
            </IconButton>
          );
        })}
        {visibleNavigationIcons.includes("editor") ? (
          <IconButton label="打开文本编辑器" active={activeNavigation === "editor"} aria-current={activeNavigation === "editor" ? "page" : undefined} onClick={onOpenEditor}><Icon name="editor" /></IconButton>
        ) : null}
        {visibleNavigationIcons.includes("browser") ? (
          <IconButton label="打开浏览器" active={activeNavigation === "browser"} aria-current={activeNavigation === "browser" ? "page" : undefined} onClick={onOpenBrowser}><Icon name="globe" /></IconButton>
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
