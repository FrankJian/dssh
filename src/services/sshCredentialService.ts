import { emit } from "@tauri-apps/api/event";
import type { SaveSshCredentialRequest, SshCredential } from "../models/sshCredential";
import { invokeCommand } from "./tauri";

export const sshCredentialsChanged = "ssh://credentials-changed";

export function listSshCredentials() {
  return invokeCommand<SshCredential[]>("list_ssh_credentials");
}

export async function saveSshCredential(request: SaveSshCredentialRequest, id?: string) {
  const credential = await invokeCommand<SshCredential>("save_ssh_credential", { request, id });
  await emit(sshCredentialsChanged).catch(() => undefined);
  return credential;
}

export function deleteSshCredential(id: string) {
  return invokeCommand<void>("delete_ssh_credential", { id });
}
