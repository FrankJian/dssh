import type { SshProfile, SshProfileIcon } from "../models";
import { createAuthDraft, type SshAuthDraft } from "./authDraft.ts";

export const embeddedAuth = "embedded";
export const newCredentialAuth = "new";

export type ProfileEditorMode = "create" | "edit";

export interface ProfileDraft extends SshAuthDraft {
  connectionType: "ssh" | "sftp";
  name: string;
  folder: string;
  host: string;
  port: string;
  authSource: string;
  credentialName: string;
  useProxy: boolean;
  proxyType: "socks5" | "http";
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  description: string;
  favorite: boolean;
  icon: SshProfileIcon;
  tags: string[];
}

export function createEmptyProfileDraft(): ProfileDraft {
  return {
    connectionType: "ssh",
    name: "",
    folder: "",
    host: "",
    port: "22",
    ...createAuthDraft(),
    authSource: embeddedAuth,
    credentialName: "",
    useProxy: false,
    proxyType: "socks5",
    proxyHost: "",
    proxyPort: "1080",
    proxyUsername: "",
    proxyPassword: "",
    description: "",
    favorite: false,
    icon: "ssh",
    tags: [],
  };
}

export function profileToDraft(profile: SshProfile): ProfileDraft {
  return {
    connectionType: profile.connectionType ?? "ssh",
    name: profile.name,
    folder: profile.folder ?? "",
    host: profile.host,
    port: String(profile.port),
    ...createAuthDraft(profile.username, profile.credentialId ? undefined : profile.authMethod),
    authSource: profile.credentialId ?? embeddedAuth,
    credentialName: "",
    useProxy: Boolean(profile.proxy),
    proxyType: profile.proxy?.proxyType ?? "socks5",
    proxyHost: profile.proxy?.host ?? "",
    proxyPort: profile.proxy ? String(profile.proxy.port) : "1080",
    proxyUsername: profile.proxy?.username ?? "",
    proxyPassword: "",
    description: profile.description ?? "",
    favorite: profile.favorite,
    icon: profile.icon ?? "ssh",
    tags: [...(profile.tags ?? [])],
  };
}

export function profileToCloneDraft(profile: SshProfile): ProfileDraft {
  return { ...profileToDraft(profile), name: `${profile.name} 克隆` };
}
