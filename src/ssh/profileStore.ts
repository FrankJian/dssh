import type { AuthMethod, SshProfile } from "../models";
import type {
  CreateSshProfileRequest,
  UpdateSshProfileRequest,
} from "../services/sshProfileService";
import type { ProfileDraft } from "./profileTypes";

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

export function buildAuthMethod(
  draft: ProfileDraft,
  existing?: SshProfile,
): AuthMethod {
  if (draft.authType === "password") {
    return {
      type: "password",
      secretRef:
        draft.password.trim().length > 0
          ? draft.password
          : existing?.authMethod.type === "password"
            ? existing.authMethod.secretRef
            : undefined,
    };
  }

  return {
    type: "privateKey",
    // Only send freshly uploaded key material; the backend keeps the existing
    // key when this is omitted.
    keyData: draft.keyData.trim().length > 0 ? draft.keyData : undefined,
    keyName: normalizeOptional(draft.keyName),
    passphraseRef:
      draft.passphrase.trim().length > 0
        ? draft.passphrase
        : existing?.authMethod.type === "privateKey"
          ? existing.authMethod.passphraseRef
          : undefined,
  };
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
    name: draft.name.trim(),
    host: draft.host.trim(),
    port: Number(draft.port),
    username: draft.username.trim(),
    authMethod: buildAuthMethod(draft),
    proxy: buildProxy(draft),
    description: normalizeOptional(draft.description),
    favorite: draft.favorite,
    tags: normalizeTags(draft.tags),
  };
}

export function updateProfileRequestFromDraft(
  profile: SshProfile,
  draft: ProfileDraft,
): UpdateSshProfileRequest {
  return {
    id: profile.id,
    name: draft.name.trim(),
    host: draft.host.trim(),
    port: Number(draft.port),
    username: draft.username.trim(),
    authMethod: buildAuthMethod(draft, profile),
    proxy: buildProxy(draft),
    description: normalizeOptional(draft.description),
    favorite: draft.favorite,
    tags: normalizeTags(draft.tags),
  };
}

export function validateProfileDraft(draft: ProfileDraft) {
  const errors: string[] = [];
  const port = Number(draft.port);

  if (!draft.name.trim()) {
    errors.push("请输入名称。");
  }

  if (!draft.host.trim()) {
    errors.push("请输入主机。");
  }

  if (!draft.username.trim()) {
    errors.push("请输入用户名。");
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

  if (
    draft.authType === "privateKey" &&
    draft.keyData.trim().length === 0 &&
    draft.keyName.trim().length === 0
  ) {
    errors.push("请上传密钥文件。");
  }

  return errors;
}
