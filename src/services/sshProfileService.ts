import { emit } from "@tauri-apps/api/event";
import type { AuthMethod, SshProfile, SshProfileIcon, SshProxy } from "../models";
import { invokeCommand } from "./tauri";

export interface CreateSshProfileRequest {
  name: string;
  folder?: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  proxy?: SshProxy;
  description?: string;
  favorite: boolean;
  icon: SshProfileIcon;
  tags: string[];
}

export interface UpdateSshProfileRequest extends CreateSshProfileRequest {
  id: string;
}

export function listSshProfiles() {
  return invokeCommand<SshProfile[]>("list_ssh_profiles");
}

export function createSshProfile(request: CreateSshProfileRequest) {
  return invokeCommand<SshProfile>("create_ssh_profile", { request });
}

export function cloneSshProfile(sourceId: string, request: CreateSshProfileRequest) {
  return invokeCommand<SshProfile>("clone_ssh_profile", { sourceId, request });
}

export function updateSshProfile(request: UpdateSshProfileRequest) {
  return invokeCommand<SshProfile>("update_ssh_profile", { request });
}

export function deleteSshProfile(id: string) {
  return invokeCommand<void>("delete_ssh_profile", { id });
}

export function renameSshTag(oldTag: string, newTag: string) {
  return invokeCommand<SshProfile[]>("rename_ssh_tag", { oldTag, newTag });
}

export function setSshProfileFavorite(id: string, favorite: boolean) {
  return invokeCommand<SshProfile>("set_ssh_profile_favorite", { id, favorite });
}

export function readKeyFile(path: string) {
  return invokeCommand<string>("read_key_file", { path });
}

export async function renameConnectionFolder(oldPath: string, newName: string) {
  await invokeCommand<void>("rename_connection_folder", { oldPath, newName });
  await emit("jumpserver://profiles-changed").catch(() => undefined);
}
