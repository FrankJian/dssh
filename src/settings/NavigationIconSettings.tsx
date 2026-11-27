import type { NavigationIconId } from "../app/ActivityBar";
import { isActivityId } from "../app/navigationPreferences";
import { Icon, type IconName } from "../ui/Icon";
import { SettingsSwitch } from "../ui/SettingsSwitch";

const OPTIONS: { id: NavigationIconId; label: string; icon: IconName }[] = [
  { id: "sessions", label: "活动会话", icon: "sessions" },
  { id: "connections", label: "连接管理", icon: "connections" },
  { id: "tools", label: "工具箱", icon: "toolbox" },
  { id: "editor", label: "文本编辑器", icon: "fileCode" },
  { id: "sftp", label: "SFTP", icon: "folder" },
  { id: "browser", label: "浏览器", icon: "globe" },
  { id: "s3", label: "S3 对象浏览器", icon: "bucket" },
  { id: "artifactory", label: "Artifactory", icon: "database" },
  { id: "assistant", label: "AI 助手", icon: "bot" },
  { id: "newLocalTerminal", label: "新建本地终端", icon: "terminalTool" },
];

export function NavigationIconSettings({ value, onChange }: { value: readonly NavigationIconId[]; onChange: (value: NavigationIconId[]) => void }) {
  const visibleActivities = value.filter(isActivityId).length;
  return <div className="appearance-settings__navigation" role="group" aria-label="左侧导航栏">
    {OPTIONS.map((option) => {
      const checked = value.includes(option.id);
      return <label className="settings-control-row" key={option.id}>
        <span className="settings-control-row__label"><Icon name={option.icon} height="16" width="16" /><span>{option.label}</span></span>
        <SettingsSwitch checked={checked} disabled={checked && isActivityId(option.id) && visibleActivities === 1}
          onChange={(event) => onChange(event.currentTarget.checked ? [...value, option.id] : value.filter((id) => id !== option.id))} />
      </label>;
    })}
  </div>;
}
