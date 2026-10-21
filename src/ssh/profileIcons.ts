import type { SshProfileIcon } from "../models";
import type { IconName } from "../ui/Icon";

export interface SshProfileIconOption {
  id: SshProfileIcon;
  icon: IconName;
  label: string;
}

export const SSH_PROFILE_ICON_OPTIONS: readonly SshProfileIconOption[] = [
  { id: "ssh", icon: "ssh", label: "SSH" },
  { id: "server", icon: "server", label: "服务器" },
  { id: "linux", icon: "linux", label: "Linux" },
  { id: "centos", icon: "centos", label: "CentOS" },
  { id: "ubuntu", icon: "ubuntu", label: "Ubuntu" },
  { id: "windows", icon: "windows", label: "Windows" },
  { id: "terminal", icon: "terminalTool", label: "终端" },
  { id: "command", icon: "command", label: "命令行" },
];

export function profileIconName(icon: SshProfileIcon | undefined): IconName {
  return SSH_PROFILE_ICON_OPTIONS.find((option) => option.id === icon)?.icon ?? "ssh";
}
