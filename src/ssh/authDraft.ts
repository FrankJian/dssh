import type { AuthMethod } from "../models/sshProfile";

export interface SshAuthDraft {
  username: string;
  authType: AuthMethod["type"];
  password: string;
  keyFilePath: string;
  keyName: string;
  passphrase: string;
}

export function createAuthDraft(
  username = "root",
  method?: AuthMethod,
): SshAuthDraft {
  return {
    username,
    authType: method?.type ?? "password",
    password: "",
    keyFilePath: "",
    keyName: method?.type === "privateKey" ? (method.keyName ?? "") : "",
    passphrase: "",
  };
}

export function buildAuthRequest(draft: SshAuthDraft) {
  const authMethod: AuthMethod = draft.authType === "password"
    ? { type: "password", secretRef: draft.password || undefined }
    : { type: "privateKey", passphraseRef: draft.passphrase || undefined };

  return {
    username: draft.username.trim(),
    authMethod,
    keyFilePath: draft.authType === "privateKey" ? draft.keyFilePath || undefined : undefined,
  };
}
