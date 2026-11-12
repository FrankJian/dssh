import { connectionTypeForProfile, connectionTypeLabel, isJumpServerProfile, isSmbProfile, type ConnectionProfile } from "../ssh/connectionTypes.ts";
import { smbConnectionAddress } from "../models/smb.ts";
import type { PaletteItem } from "./CommandPalette";
import { buildConnectionFolders, type ConnectionFolderNode } from "../ssh/connectionFolders.ts";

export type ConnectionGroupScope = `folder:${string}` | `tag:${string}`;
export interface ConnectionGroupRequest { scope: ConnectionGroupScope; requestId: number }
interface GroupProfile { folder?: string; tags: string[] }

export function connectionSearchKeywords(profile: { folder?: string; tags?: string[]; host?: string; username?: string; description?: string }): string {
  return `${profile.folder ? `目录 folder directory ${profile.folder}` : ""} ${profile.tags?.length ? `标签 tag ${profile.tags.join(" ")}` : ""} ${profile.host ?? ""} ${profile.username ?? ""} ${profile.description ?? ""}`;
}

export function connectionGroupPaletteItems(profiles: GroupProfile[], onSelect: (scope: ConnectionGroupScope) => void): PaletteItem[] {
  const items: PaletteItem[] = [];
  function addFolders(nodes: ConnectionFolderNode[]) {
    for (const node of nodes) {
      items.push({ id: `conn-group:folder:${node.path}`, label: `目录：${node.path}`, hint: `${node.count} 个连接 · 目录分组`,
        searchPriority: -1, icon: "folder", keywords: `folder directory 目录 分组 ${node.path}`, run: () => onSelect(`folder:${node.path}`) });
      addFolders(node.children);
    }
  }
  addFolders(buildConnectionFolders(profiles));
  const tags = [...new Set(profiles.flatMap((profile) => profile.tags))].sort((a, b) => a.localeCompare(b));
  for (const tag of tags) {
    const count = profiles.filter((profile) => profile.tags.includes(tag)).length;
    items.push({ id: `conn-group:tag:${tag}`, label: `标签：${tag}`, hint: `${count} 个连接 · 标签分组`,
      searchPriority: -1, icon: "tag", keywords: `tag 标签 分组 ${tag}`, run: () => onSelect(`tag:${tag}`) });
  }
  return items;
}

export function connectionActionPaletteItems(profiles: ConnectionProfile[], actions: {
  onOpen: (profile: ConnectionProfile) => void;
  onEdit: (profile: ConnectionProfile) => void;
}): PaletteItem[] {
  return profiles.flatMap((profile): PaletteItem[] => {
    const type = connectionTypeForProfile(profile);
    const label = connectionTypeLabel(type);
    const address = isJumpServerProfile(profile) ? profile.coreUrl : isSmbProfile(profile) ? smbConnectionAddress(profile) : `${profile.username}@${profile.host}:${profile.port}`;
    const keywords = `${type} ${connectionSearchKeywords(profile)} ${isSmbProfile(profile) ? profile.sharePath : ""}`;
    const openId = type === "ssh" ? `conn:${profile.id}` : `${type}:${profile.id}`;
    return [
      { id: openId, label: `${type === "jumpserver" ? "打开资产" : type === "rdp" ? "远程桌面" : type === "sftp" ? "打开 SFTP" : type === "smb" ? "打开网络共享" : "连接 SSH"}：${profile.name}`,
        hint: address, icon: type === "jumpserver" ? "stackedHexagon" : type === "rdp" ? "monitor" : type === "sftp" || type === "smb" ? "folder" : "ssh",
        keywords: `${keywords} connect open 打开 连接`, run: () => actions.onOpen(profile) },
      { id: type === "ssh" ? `conn:edit:${profile.id}` : `${type}:edit:${profile.id}`, label: `编辑 ${label} 配置：${profile.name}`,
        hint: address, icon: "edit", keywords: `${keywords} edit 编辑`, run: () => actions.onEdit(profile) },
    ];
  });
}
