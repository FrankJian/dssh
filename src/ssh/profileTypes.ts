import type { AuthMethod, SshProfile } from "../models";

export type ProfileEditorMode = "create" | "edit";

export interface ProfileDraft {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: AuthMethod["type"];
  password: string;
  // Freshly uploaded key contents, empty when the stored key is kept as-is.
  keyData: string;
  // File name of the key: either the stored one (edit) or the uploaded one.
  keyName: string;
  passphrase: string;
  useProxy: boolean;
  proxyType: "socks5" | "http";
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  description: string;
  favorite: boolean;
  tags: string[];
}

export function createEmptyProfileDraft(): ProfileDraft {
  return {
    name: "",
    host: "",
    port: "22",
    username: "root",
    authType: "password",
    password: "",
    keyData: "",
    keyName: "",
    passphrase: "",
    useProxy: false,
    proxyType: "socks5",
    proxyHost: "",
    proxyPort: "1080",
    proxyUsername: "",
    proxyPassword: "",
    description: "",
    favorite: false,
    tags: [],
  };
}

export function profileToDraft(profile: SshProfile): ProfileDraft {
  return {
    name: profile.name,
    host: profile.host,
    port: String(profile.port),
    username: profile.username,
    authType: profile.authMethod.type,
    password: "",
    keyData: "",
    keyName: profile.authMethod.type === "privateKey" ? (profile.authMethod.keyName ?? "") : "",
    passphrase: "",
    useProxy: Boolean(profile.proxy),
    proxyType: profile.proxy?.proxyType ?? "socks5",
    proxyHost: profile.proxy?.host ?? "",
    proxyPort: profile.proxy ? String(profile.proxy.port) : "1080",
    proxyUsername: profile.proxy?.username ?? "",
    proxyPassword: "",
    description: profile.description ?? "",
    favorite: profile.favorite,
    tags: profile.tags ?? [],
  };
}
