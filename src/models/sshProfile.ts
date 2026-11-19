export type AuthMethod =
  | {
      type: "password";
      secretRef?: string;
    }
  | {
      type: "privateKey";
      keyName?: string;
      passphraseRef?: string;
    };

export type SshProfileIcon =
  | "ssh"
  | "server"
  | "linux"
  | "centos"
  | "ubuntu"
  | "windows"
  | "terminal"
  | "command";

export interface SshProxy {
  proxyType: "socks5" | "http";
  host: string;
  port: number;
  username?: string;
  /** Only sent when creating/updating; never returned by the backend. */
  password?: string;
}

export interface SshProfile {
  /** Missing legacy values are SSH. Both types share SSH transport. */
  connectionType?: "ssh" | "sftp";
  id: string;
  name: string;
  folder?: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  credentialId?: string;
  proxy?: SshProxy;
  description?: string;
  favorite: boolean;
  icon: SshProfileIcon;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
