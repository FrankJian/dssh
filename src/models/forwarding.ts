export type ForwardKind = "local" | "remote" | "dynamic";

export interface PortForward {
  id: string;
  sessionId: string;
  kind: ForwardKind;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  description?: string | null;
}

export interface StartPortForwardRequest {
  sessionId: string;
  profileId: string;
  kind: ForwardKind;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  description?: string | null;
}
