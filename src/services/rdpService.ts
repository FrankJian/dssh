import { listen } from "@tauri-apps/api/event";
import type { PasswordUpdate, RdpConnectionProfile, RdpEngineStatus, RdpProfile, RdpSession } from "../models/rdp";
import { invokeCommand } from "./tauri";

export async function listRdpProfiles(): Promise<RdpConnectionProfile[]> {
  return (await invokeCommand<RdpProfile[]>("list_rdp_profiles")).map((profile) => ({ ...profile, protocol: "rdp" }));
}
export function saveRdpProfile(profile: RdpProfile, password: PasswordUpdate, cloneSourceId?: string) {
  // The UI discriminator never enters the persisted DTO.
  const { id, name, host, port, username, domain, certificateFingerprint, skipCertificateVerification, clipboardMode, width, height, favorite,
    tags, description, hasPassword, createdAt, updatedAt } = profile;
  return invokeCommand<RdpProfile>("save_rdp_profile", { request: { profile: { id, name, host, port, username, domain,
    certificateFingerprint, skipCertificateVerification, clipboardMode, width, height, favorite, tags, description, hasPassword, createdAt, updatedAt }, password, cloneSourceId } });
}
export const deleteRdpProfile = (id: string) => invokeCommand<void>("delete_rdp_profile", { id });
export const rdpEngineStatus = () => invokeCommand<RdpEngineStatus>("rdp_engine_status");
export const listRdpSessions = () => invokeCommand<RdpSession[]>("list_rdp_sessions");
export const startRdpSession = (profileId: string, password?: string) => invokeCommand<RdpSession>("start_rdp_session", { profileId, password });
export const closeRdpSession = (id: string) => invokeCommand<void>("close_rdp_session", { id });
export const focusRdpSession = (id: string) => invokeCommand<void>("focus_rdp_session", { id });
export const onRdpSession = (handler: (session: RdpSession) => void) => listen<RdpSession>("rdp://session-status", (event) => handler(event.payload));
