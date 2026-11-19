import type { AuthMethod } from "./sshProfile";

export interface SshCredential {
  id: string;
  name: string;
  username: string;
  authMethod: AuthMethod;
  connectionCount: number;
}

export interface SaveSshCredentialRequest {
  name: string;
  username: string;
  authMethod: AuthMethod;
  keyFilePath?: string;
  clearPassphrase?: boolean;
}
