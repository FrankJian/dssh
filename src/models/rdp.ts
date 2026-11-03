export interface RdpProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  domain: string;
  certificateFingerprint: string;
  skipCertificateVerification: boolean;
  clipboardMode: "off" | "text" | "textAndFiles";
  width: number;
  height: number;
  favorite: boolean;
  tags: string[];
  description: string;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}
export type RdpConnectionProfile = RdpProfile & { protocol: "rdp" };
export type PasswordUpdate = { action: "keep" } | { action: "clear" } | { action: "replace"; value: string };
export interface RdpSession {
  id: string;
  profileId: string;
  title: string;
  status: "starting" | "connecting" | "connected" | "disconnecting" | "closed" | "failed";
  message: string | null;
  revision: number;
  certificateVerificationSkipped: boolean;
}
export interface RdpEngineStatus { available: boolean; message: string }
export function emptyRdpProfile(): RdpProfile {
  return { id: "", name: "", host: "", port: 3389, username: "", domain: "", certificateFingerprint: "", skipCertificateVerification: false,
    clipboardMode: "off", width: 1920, height: 1080, favorite: false, tags: [], description: "", hasPassword: false, createdAt: "", updatedAt: "" };
}
