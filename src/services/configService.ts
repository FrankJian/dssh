import type { SshProfile } from "../models";
import { invokeCommand } from "./tauri";

export function exportProfilesYaml() {
  return invokeCommand<string>("export_profiles_yaml");
}

export function importProfilesYaml(yaml: string) {
  return invokeCommand<SshProfile[]>("import_profiles_yaml", { yaml });
}

export function exportProfilesEncrypted(password: string) {
  return invokeCommand<string>("export_profiles_encrypted", { password });
}

export function importProfilesEncrypted(blob: string, password: string) {
  return invokeCommand<SshProfile[]>("import_profiles_encrypted", { blob, password });
}

export function readTextFile(path: string) {
  return invokeCommand<string>("read_text_file", { path });
}

export function writeTextFile(path: string, contents: string) {
  return invokeCommand<void>("write_text_file", { path, contents });
}

/** Read a local image as a data: URL (used for the terminal background). */
export function readImageDataUrl(path: string) {
  return invokeCommand<string>("read_image_data_url", { path });
}
