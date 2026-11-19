import { normalizeConnectionFolder } from "./connectionFolders";
import { buildAuthRequest } from "./authDraft";
import type {
  CreateSshProfileRequest,
  UpdateSshProfileRequest,
} from "../services/sshProfileService";
import { embeddedAuth, newCredentialAuth, type ProfileDraft } from "./profileTypes";

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildProxy(draft: ProfileDraft) {
  if (!draft.useProxy) return undefined;
  return {
    proxyType: draft.proxyType,
    host: draft.proxyHost.trim(),
    port: Number(draft.proxyPort),
    username: normalizeOptional(draft.proxyUsername),
    password: normalizeOptional(draft.proxyPassword),
  };
}

function profileAuthentication(draft: ProfileDraft) {
  if (draft.authSource === embeddedAuth) return buildAuthRequest(draft);
  if (draft.authSource === newCredentialAuth) {
    return { newCredential: { name: draft.credentialName.trim(), ...buildAuthRequest(draft) } };
  }
  return { credentialId: draft.authSource };
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export function createProfileRequestFromDraft(draft: ProfileDraft): CreateSshProfileRequest {
  return {
    connectionType: draft.connectionType,
    name: draft.name.trim(),
    folder: normalizeConnectionFolder(draft.folder),
    host: draft.host.trim(),
    port: Number(draft.port),
    ...profileAuthentication(draft),
    proxy: buildProxy(draft),
    description: normalizeOptional(draft.description),
    favorite: draft.favorite,
    icon: draft.icon,
    tags: normalizeTags(draft.tags),
  };
}

export function updateProfileRequestFromDraft(
  id: string,
  draft: ProfileDraft,
): UpdateSshProfileRequest {
  return { ...createProfileRequestFromDraft(draft), id };
}

export function validateProfileDraft(draft: ProfileDraft, wasLinked = false) {
  const errors: string[] = [];
  try { normalizeConnectionFolder(draft.folder); } catch (error) { errors.push((error as Error).message); }
  const port = Number(draft.port);

  if (!draft.name.trim()) {
    errors.push("请输入名称。");
  }

  if (!draft.host.trim()) {
    errors.push("请输入主机。");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("端口必须是 1 到 65535 之间的整数。");
  }
  const proxyPort = Number(draft.proxyPort);
  if (
    draft.useProxy &&
    (!draft.proxyHost.trim() || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)
  ) {
    errors.push("请输入有效的代理主机和端口。");
  }

  if (draft.authSource === embeddedAuth || draft.authSource === newCredentialAuth) {
    const creatingCredential = draft.authSource === newCredentialAuth;
    if (creatingCredential && !draft.credentialName.trim()) {
      errors.push("请输入凭据名称。");
    }
    if (!draft.username.trim()) {
      errors.push("请输入用户名。");
    }
    if ((creatingCredential || wasLinked) && draft.authType === "password" && !draft.password) {
      errors.push("请输入密码。");
    }
    if (draft.authType === "privateKey" && !draft.keyFilePath &&
      (creatingCredential || wasLinked || !draft.keyName)) {
      errors.push("请选择密钥文件。");
    }
  }

  return errors;
}
