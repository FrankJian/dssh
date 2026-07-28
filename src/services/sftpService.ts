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

export interface SftpTextFile {
  content: string;
}

export interface SftpImageFile {
  dataUrl: string;
}

export function sftpHome(profileId: string) {
  return invokeCommand<string>("sftp_home", { profileId });
}

export function sftpList(profileId: string, path: string) {
  return invokeCommand<SftpListing>("sftp_list", { profileId, path });
}

export function sftpReadText(profileId: string, remotePath: string) {
  return invokeCommand<SftpTextFile>("sftp_read_text", { profileId, remotePath });
}

export function sftpWriteText(profileId: string, remotePath: string, content: string) {
  return invokeCommand<void>("sftp_write_text", { content, profileId, remotePath });
}

export function sftpReadImage(profileId: string, remotePath: string) {
  return invokeCommand<SftpImageFile>("sftp_read_image", { profileId, remotePath });
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

export function sftpCreateDir(profileId: string, parentPath: string, name: string) {
  return invokeCommand<string>("sftp_create_dir", { name, parentPath, profileId });
}

export function sftpCreateFile(profileId: string, parentPath: string, name: string) {
  return invokeCommand<string>("sftp_create_file", { name, parentPath, profileId });
}

export function sftpRename(profileId: string, remotePath: string, newName: string) {
  return invokeCommand<string>("sftp_rename", { newName, profileId, remotePath });
}

export function sftpDeleteFile(profileId: string, remotePath: string) {
  return invokeCommand<void>("sftp_delete_file", { profileId, remotePath });
}

export function sftpDeleteEmptyDir(profileId: string, remotePath: string) {
  return invokeCommand<void>("sftp_delete_empty_dir", { profileId, remotePath });
}

export function sftpDisconnect(profileId: string) {
  return invokeCommand<void>("sftp_disconnect", { profileId });
}
