import { invokeCommand } from "./tauri";
import { listen } from "@tauri-apps/api/event";

export interface ArtifactoryProfile { id: string; name: string; baseUrl: string; hasToken: boolean }
export interface ArtifactoryRepository { key: string; type: string; packageType: string; description?: string }
export interface ArtifactoryChild { uri: string; folder: boolean }
export interface ArtifactoryFolder { children: ArtifactoryChild[] }
export interface ArtifactoryItemInfo { path?: string; size?: string; mimeType?: string; created?: string; createdBy?: string; lastModified?: string; modifiedBy?: string; checksums?: Record<string, string>; properties?: Record<string, string[]>; propertiesError?: string }
export interface SaveArtifactoryProfileRequest { id?: string; name: string; baseUrl: string; token?: string }
export type ArtifactoryTransferKind = "upload" | "download" | "archive";
export type ArtifactoryTransferStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface ArtifactoryTransfer {
  id: string;
  profileId: string;
  repo: string;
  path: string;
  name: string;
  kind: ArtifactoryTransferKind;
  status: ArtifactoryTransferStatus;
  transferred: number;
  total?: number;
  error?: string;
}
export interface EnqueueArtifactoryTransfer {
  profileId: string;
  repo: string;
  path: string;
  localPath: string;
  kind: ArtifactoryTransferKind;
  overwrite?: boolean;
}

export const listArtifactoryProfiles = () => invokeCommand<ArtifactoryProfile[]>("list_artifactory_profiles");
export const saveArtifactoryProfile = (request: SaveArtifactoryProfileRequest) => invokeCommand<ArtifactoryProfile>("save_artifactory_profile", { request });
export const deleteArtifactoryProfile = (id: string) => invokeCommand<void>("delete_artifactory_profile", { id });
export const artifactoryRepositories = (profileId: string) => invokeCommand<ArtifactoryRepository[]>("artifactory_repositories", { profileId });
export const artifactoryListFolder = (profileId: string, repo: string, path: string) => invokeCommand<ArtifactoryFolder>("artifactory_list_folder", { profileId, repo, path });
export const artifactoryItemInfo = (profileId: string, repo: string, path: string) => invokeCommand<ArtifactoryItemInfo>("artifactory_item_info", { profileId, repo, path });
export const artifactoryUpload = (profileId: string, repo: string, path: string, localPath: string) => invokeCommand<void>("artifactory_upload", { profileId, repo, path, localPath });
export const artifactoryDownload = (profileId: string, repo: string, path: string, localPath: string, overwrite = false) => invokeCommand<void>("artifactory_download", { profileId, repo, path, localPath, overwrite });
export const setArtifactoryProperty = (profileId: string, repo: string, path: string, key: string, values: string[]) => invokeCommand<void>("artifactory_set_property", { profileId, repo, path, key, values });
export const deleteArtifactoryProperty = (profileId: string, repo: string, path: string, key: string) => invokeCommand<void>("artifactory_delete_property", { profileId, repo, path, key });
export const enqueueArtifactoryTransfer = (request: EnqueueArtifactoryTransfer) => invokeCommand<ArtifactoryTransfer>("artifactory_enqueue_transfer", { request });
export const listArtifactoryTransfers = () => invokeCommand<ArtifactoryTransfer[]>("artifactory_list_transfers");
export const cancelArtifactoryTransfer = (id: string) => invokeCommand<void>("artifactory_cancel_transfer", { id });
export const retryArtifactoryTransfer = (id: string, overwrite = false) => invokeCommand<ArtifactoryTransfer>("artifactory_retry_transfer", { id, overwrite });
export const clearArtifactoryTransfers = () => invokeCommand<void>("artifactory_clear_transfers");
export const onArtifactoryTransfer = (handler: (task: ArtifactoryTransfer) => void) => listen<ArtifactoryTransfer>("artifactory://transfer", (event) => handler(event.payload));
