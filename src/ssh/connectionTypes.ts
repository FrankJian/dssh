import type { SshProfile } from "../models";
import type { IconName } from "../ui/Icon";

/**
 * The connection-type catalogue is intentionally independent from SshProfile.
 * The latter still represents the only persisted connection implementation;
 * future Telnet/SFTP profile types can join this catalogue without changing
 * the new-connection flow or grouping UI.
 */
export type ConnectionType = "ssh" | "kubernetes" | "telnet" | "sftp";

export interface ConnectionTypeOption {
  id: ConnectionType;
  label: string;
  description: string;
  icon: IconName;
  available: boolean;
}

export const CONNECTION_TYPE_OPTIONS: readonly ConnectionTypeOption[] = [
  {
    available: true,
    description: "集群资源浏览与 kubectl 工作区",
    icon: "database",
    id: "kubernetes",
    label: "Kubernetes",
  },
  {
    available: true,
    description: "远程终端、文件管理与端口转发",
    icon: "ssh",
    id: "ssh",
    label: "SSH",
  },
  {
    available: false,
    description: "传统远程终端协议",
    icon: "terminalTool",
    id: "telnet",
    label: "Telnet",
  },
  {
    available: false,
    description: "独立文件传输连接",
    icon: "folder",
    id: "sftp",
    label: "SFTP",
  },
];

export const CONNECTION_GROUP_BY_OPTIONS = [
  { id: "type", label: "类型" },
  { id: "tag", label: "标签" },
] as const;

export type ConnectionGroupBy = (typeof CONNECTION_GROUP_BY_OPTIONS)[number]["id"];

export interface ConnectionTypeGroup {
  key: ConnectionType;
  label: string;
  profiles: SshProfile[];
}

/** All existing persisted profiles are SSH profiles until other backends land. */
export function connectionTypeForProfile(_profile: SshProfile): ConnectionType {
  return "ssh";
}

export function connectionTypeLabel(type: ConnectionType): string {
  return CONNECTION_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? type;
}

/**
 * Temporary SSH-profile adapter for the Session Manager. Replace this with the
 * future ConnectionProfile union once non-SSH profiles have a backend.
 */
export function groupSshProfilesByConnectionType(profiles: SshProfile[]): ConnectionTypeGroup[] {
  const sshProfiles = profiles.filter((profile) => connectionTypeForProfile(profile) === "ssh");
  return sshProfiles.length > 0 ? [{ key: "ssh", label: connectionTypeLabel("ssh"), profiles: sshProfiles }] : [];
}
