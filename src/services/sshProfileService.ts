import type { AuthMethod, SshProfile, SshProxy } from "../models";
import { invokeCommand } from "./tauri";

export interface CreateSshProfileRequest {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  proxy?: SshProxy;
  description?: string;
  favorite: boolean;
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

export function updateSshProfile(request: UpdateSshProfileRequest) {
  return invokeCommand<SshProfile>("update_ssh_profile", { request });
}

export function deleteSshProfile(id: string) {
  return invokeCommand<void>("delete_ssh_profile", { id });
}

export function setSshProfileFavorite(id: string, favorite: boolean) {
  return invokeCommand<SshProfile>("set_ssh_profile_favorite", { id, favorite });
}

export function readKeyFile(path: string) {
  return invokeCommand<string>("read_key_file", { path });
}
