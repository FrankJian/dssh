import type { SmbProfile } from "../models/smb";
import { invokeCommand } from "./tauri";

export const listSmbProfiles = () => invokeCommand<SmbProfile[]>("list_smb_profiles");
export const saveSmbProfile = (profile: SmbProfile) => invokeCommand<SmbProfile>("save_smb_profile", { profile });
export const deleteSmbProfile = (id: string) => invokeCommand<void>("delete_smb_profile", { id });
export const mapSmbProfile = (id: string) => invokeCommand<void>("map_smb_profile", { id });
export const unmapSmbProfile = (id: string) => invokeCommand<void>("unmap_smb_profile", { id });
