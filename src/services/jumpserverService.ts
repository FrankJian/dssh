import { emit, listen } from "@tauri-apps/api/event";
import type { JumpServerLoginResult, JumpServerAccount, JumpServerAsset, JumpServerIdentity, JumpServerNode, JumpServerPage, JumpServerProfile, JumpServerTarget, SaveJumpServerProfile } from "../models/jumpserver";
import type { TerminalSession } from "../models";
import { invokeCommand } from "./tauri";
export const listJumpServerProfiles = () => invokeCommand<JumpServerProfile[]>("list_jumpserver_profiles");
export async function saveJumpServerProfile(request: SaveJumpServerProfile) {
  const profile = await invokeCommand<JumpServerProfile>("save_jumpserver_profile", { request });
  await emit("jumpserver://profiles-changed").catch(() => undefined);
  return profile;
}
export async function deleteJumpServerProfile(id: string) {
  await invokeCommand<void>("delete_jumpserver_profile", { id });
  await emit("jumpserver://profiles-changed").catch(() => undefined);
}
export const jumpServerIdentity = (id: string) => invokeCommand<JumpServerIdentity | null>("jumpserver_identity", { id });
export const loginJumpServer = (id: string, secret?: string) => invokeCommand<JumpServerLoginResult>("jumpserver_login", { id, secret: secret || null });
export const logoutJumpServer = (id: string) => invokeCommand<void>("jumpserver_logout", { id });
export const listJumpServerAssets = (profileId: string, generation: string, search: string, offset: number, nodeId: string | null) =>
  invokeCommand<JumpServerPage<JumpServerAsset>>("jumpserver_list_assets", { query: { profileId, generation, search, offset, nodeId } });
export const listJumpServerNodes = (id: string, generation: string, offset: number) =>
  invokeCommand<JumpServerPage<JumpServerNode>>("jumpserver_list_nodes", { id, generation, offset });
export const listJumpServerAccounts = (id: string, generation: string, assetId: string) =>
  invokeCommand<JumpServerAccount[]>("jumpserver_list_accounts", { id, generation, assetId });
export const openJumpServerTerminal = (target: JumpServerTarget) => invokeCommand<TerminalSession>("jumpserver_open_terminal", { target, size: { cols: 120, rows: 36 } });

export const onJumpServerTargetsClosed = (handler: (ids: string[]) => void) => listen<string[]>("jumpserver://targets-closed", (event) => handler(event.payload));

export const verifyJumpServerOtp = (id: string, challengeId: string, code: string) => invokeCommand<JumpServerLoginResult>("jumpserver_verify_otp", { id, challengeId, code });
export const cancelJumpServerLogin = (id: string, challengeId: string) => invokeCommand<void>("jumpserver_cancel_login", { id, challengeId });
export const openJumpServerSshGateway = (id: string) => invokeCommand<TerminalSession>("jumpserver_open_ssh_gateway", { id, size: { cols: 120, rows: 36 } });
