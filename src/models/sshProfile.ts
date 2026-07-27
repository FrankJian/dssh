export type AuthMethod =
  | {
      type: "password";
      secretRef?: string;
    }
  | {
      type: "privateKey";
      // The key material is only ever sent from the UI to the backend on
      // upload; it is never returned in profile responses.
      keyData?: string;
      keyName?: string;
      passphraseRef?: string;
    };

export interface SshProxy {
  proxyType: "socks5" | "http";
  host: string;
  port: number;
  username?: string;
  /** Only sent when creating/updating; never returned by the backend. */
  password?: string;
}

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  proxy?: SshProxy;
  description?: string;
  favorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
