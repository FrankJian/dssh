import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "./tauri";

export const SFTP_TRANSFER_PROGRESS_EVENT = "sftp://transfer-progress";

export interface SftpTransferProgress {
  operationId: string;
  profileId: string;
  direction: "delete" | "download" | "upload";
  name: string;
  path: string;
  transferred: number;
  total: number | null;
  done: boolean;
}

export function onSftpTransferProgress(handler: (progress: SftpTransferProgress) => void) {
  return listen<SftpTransferProgress>(SFTP_TRANSFER_PROGRESS_EVENT, (event) =>
    handler(event.payload),
  );
}

/** @deprecated Prefer the direction-aware `onSftpTransferProgress`. */
export function onSftpDownloadProgress(handler: (progress: SftpTransferProgress) => void) {
  return onSftpTransferProgress((progress) => {
    if (progress.direction === "download") {
      handler(progress);
    }
  });
}

export function createSftpOperationId(direction: "delete" | "download" | "upload") {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sftp-${direction}-${suffix}`;
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

export interface LocalFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
}

export interface LocalListing {
  path: string;
  entries: LocalFileEntry[];
}

export interface LocalRoot {
  path: string;
  label: string;
}

export interface SftpTextFile {
  content: string;
}

export interface SftpImageFile {
  dataUrl: string;
}

export interface SftpFileInfo {
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  permissions: number | null;
  user: string | null;
  group: string | null;
}

export interface SftpDeletePreview {
  path: string;
  files: number;
  directories: number;
  symlinks: number;
  paths: string[];
  truncated: boolean;
}

export interface SftpDeleteResult {
  deleted: number;
  total: number;
  cancelled: boolean;
}

export function sftpHome(profileId: string) {
  return invokeCommand<string>("sftp_home", { profileId });
}

export function sftpList(profileId: string, path: string) {
  return invokeCommand<SftpListing>("sftp_list", { profileId, path });
}

export function sftpLocalHome() {
  return invokeCommand<string>("sftp_local_home");
}

export function sftpLocalRoots() {
  return invokeCommand<LocalRoot[]>("sftp_local_roots");
}

export function sftpLocalList(path: string) {
  return invokeCommand<LocalListing>("sftp_local_list", { path });
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

export function sftpDownload(
  profileId: string,
  remotePath: string,
  localPath: string,
  operationId = createSftpOperationId("download"),
) {
  return invokeCommand<void>("sftp_download", { profileId, remotePath, localPath, operationId });
}

export function sftpDownloadDir(
  profileId: string,
  remotePath: string,
  localPath: string,
  operationId = createSftpOperationId("download"),
) {
  return invokeCommand<void>("sftp_download_dir", { profileId, remotePath, localPath, operationId });
}

export function sftpDownloadTree(
  profileId: string,
  remotePath: string,
  localPath: string,
  operationId = createSftpOperationId("download"),
) {
  return invokeCommand<void>("sftp_download_tree", { profileId, remotePath, localPath, operationId });
}

export function sftpUpload(
  profileId: string,
  localPath: string,
  remotePath: string,
  operationId = createSftpOperationId("upload"),
) {
  return invokeCommand<void>("sftp_upload", { profileId, localPath, remotePath, operationId });
}

export function sftpUploadDir(
  profileId: string,
  localPath: string,
  remotePath: string,
  operationId = createSftpOperationId("upload"),
) {
  return invokeCommand<void>("sftp_upload_dir", { profileId, localPath, remotePath, operationId });
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

export function sftpFileInfo(profileId: string, remotePath: string) {
  return invokeCommand<SftpFileInfo>("sftp_file_info", { profileId, remotePath });
}

export function sftpSetPermissions(profileId: string, remotePath: string, permissions: number) {
  return invokeCommand<void>("sftp_set_permissions", { profileId, remotePath, permissions });
}

export function sftpMoveEntries(profileId: string, sources: string[], targetDir: string) {
  return invokeCommand<string[]>("sftp_move_entries", { profileId, sources, targetDir });
}

export function sftpDeletePreview(profileId: string, remotePath: string) {
  return invokeCommand<SftpDeletePreview>("sftp_delete_preview", { profileId, remotePath });
}

export function sftpDeleteRecursive(
  profileId: string,
  remotePath: string,
  operationId = createSftpOperationId("delete"),
) {
  return invokeCommand<SftpDeleteResult>("sftp_delete_recursive", {
    profileId,
    remotePath,
    operationId,
  });
}

export function sftpCancelOperation(operationId: string) {
  return invokeCommand<void>("sftp_cancel_operation", { operationId });
}

export function sftpDisconnect(profileId: string) {
  return invokeCommand<void>("sftp_disconnect", { profileId });
}
