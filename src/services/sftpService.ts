import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "./tauri";

export const SFTP_DOWNLOAD_PROGRESS_EVENT = "sftp://download-progress";

export interface SftpDownloadProgress {
  profileId: string;
  path: string;
  transferred: number;
  total: number | null;
  done: boolean;
}

export function onSftpDownloadProgress(handler: (progress: SftpDownloadProgress) => void) {
  return listen<SftpDownloadProgress>(SFTP_DOWNLOAD_PROGRESS_EVENT, (event) =>
    handler(event.payload),
  );
}

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
}

export interface SftpListing {
  path: string;
  entries: SftpEntry[];
}

export function sftpHome(profileId: string) {
  return invokeCommand<string>("sftp_home", { profileId });
}

export function sftpList(profileId: string, path: string) {
  return invokeCommand<SftpListing>("sftp_list", { profileId, path });
}

export function sftpDownload(profileId: string, remotePath: string, localPath: string) {
  return invokeCommand<void>("sftp_download", { profileId, remotePath, localPath });
}

export function sftpDownloadDir(profileId: string, remotePath: string, localPath: string) {
  return invokeCommand<void>("sftp_download_dir", { profileId, remotePath, localPath });
}

export function sftpUpload(profileId: string, localPath: string, remotePath: string) {
  return invokeCommand<void>("sftp_upload", { profileId, localPath, remotePath });
}

export function sftpDisconnect(profileId: string) {
  return invokeCommand<void>("sftp_disconnect", { profileId });
}
