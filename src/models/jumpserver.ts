export type JumpServerAuthKind = "password" | "accessKey";
export interface JumpServerProfile {
  id: string; name: string; coreUrl: string; keyId: string; orgId: string; hasCredential: boolean;
  authKind: JumpServerAuthKind; username: string; sshProfileId: string | null;
}
export interface JumpServerIdentity { userId: string; username: string; orgId: string; generation: string }
export interface JumpServerAsset { id: string; name: string; address: string; nodeIds: string[]; active: boolean }
export interface JumpServerNode { id: string; name: string; key: string }
export interface JumpServerAccount { alias: string; name: string; username: string; supported: boolean }
export interface JumpServerPage<T> { results: T[]; count: number | null; hasMore: boolean }
export interface JumpServerTarget { profileId: string; generation: string; assetId: string; assetName: string; accountAlias: string; accountLabel: string }
export interface SaveJumpServerProfile {
  cloneSourceId?: string;
  id?: string; name: string; coreUrl: string; keyId: string; orgId: string;
  authKind: JumpServerAuthKind; username: string; sshProfileId?: string | null;
  /** Write-only. Never retained in profile responses or localStorage. */
  secret?: string; rememberSecret: boolean;
}
export const isJumpServerSource = (profileId: string) => profileId.startsWith("jms:");

export type JumpServerLoginResult = { status: "ready"; identity: JumpServerIdentity } | { status: "otpRequired"; challengeId: string };
