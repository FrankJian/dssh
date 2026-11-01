import type { SshProfile } from "../models";
import type { RdpConnectionProfile } from "../models/rdp";
import type { IconName } from "../ui/Icon";

/**
 * The connection-type catalogue is intentionally independent from SshProfile.
 * SSH and RDP keep their own persisted DTOs and are aggregated only for display.
 * Future protocols can join without adding unrelated fields to SshProfile.
 */
export type ConnectionType = "ssh" | "telnet" | "sftp" | "rdp";
export type ConnectionProfile = SshProfile | RdpConnectionProfile;
export function isRdpProfile(profile: ConnectionProfile): profile is RdpConnectionProfile {
  return "protocol" in profile && profile.protocol === "rdp";
}

export interface ConnectionTypeOption {
  id: ConnectionType;
  label: string;
  description: string;
  icon: IconName;
  available: boolean;
}

export const CONNECTION_TYPE_OPTIONS: readonly ConnectionTypeOption[] = [
  { available: true, description: "Windows 远程桌面（独立窗口）", icon: "monitor", id: "rdp", label: "RDP" },
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

/** Connection cards use a discriminator; legacy SSH DTOs remain compatible. */
export function connectionTypeForProfile(profile: ConnectionProfile): ConnectionType {
  return isRdpProfile(profile) ? "rdp" : "ssh";
}

export function connectionTypeLabel(type: ConnectionType): string {
  return CONNECTION_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? type;
}

/**
 * Temporary SSH-profile adapter for the Session Manager. Replace this with the
 * ConnectionProfile union is used by the multi-protocol Session Manager.
 */
export function groupSshProfilesByConnectionType(profiles: SshProfile[]): ConnectionTypeGroup[] {
  const sshProfiles = profiles.filter((profile) => connectionTypeForProfile(profile) === "ssh");
  return sshProfiles.length > 0 ? [{ key: "ssh", label: connectionTypeLabel("ssh"), profiles: sshProfiles }] : [];
}
