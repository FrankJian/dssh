import { invokeCommand } from "./tauri";

export interface ArtifactoryProfile { id: string; name: string; baseUrl: string; hasToken: boolean }
export interface ArtifactoryRepository { key: string; type: string; packageType: string; description?: string }
export interface ArtifactoryChild { uri: string; folder: boolean }
export interface ArtifactoryFolder { children: ArtifactoryChild[] }
export interface ArtifactoryItemInfo { path?: string; size?: string; mimeType?: string; created?: string; createdBy?: string; lastModified?: string; modifiedBy?: string; checksums?: Record<string, string>; properties?: Record<string, string[]>; propertiesError?: string }
export interface SaveArtifactoryProfileRequest { id?: string; name: string; baseUrl: string; token?: string }

export const listArtifactoryProfiles = () => invokeCommand<ArtifactoryProfile[]>("list_artifactory_profiles");
export const saveArtifactoryProfile = (request: SaveArtifactoryProfileRequest) => invokeCommand<ArtifactoryProfile>("save_artifactory_profile", { request });
export const deleteArtifactoryProfile = (id: string) => invokeCommand<void>("delete_artifactory_profile", { id });
export const artifactoryRepositories = (profileId: string) => invokeCommand<ArtifactoryRepository[]>("artifactory_repositories", { profileId });
export const artifactoryListFolder = (profileId: string, repo: string, path: string) => invokeCommand<ArtifactoryFolder>("artifactory_list_folder", { profileId, repo, path });
export const artifactoryItemInfo = (profileId: string, repo: string, path: string) => invokeCommand<ArtifactoryItemInfo>("artifactory_item_info", { profileId, repo, path });
export const artifactoryUpload = (profileId: string, repo: string, path: string, localPath: string) => invokeCommand<void>("artifactory_upload", { profileId, repo, path, localPath });
export const artifactoryDownload = (profileId: string, repo: string, path: string, localPath: string, overwrite = false) => invokeCommand<void>("artifactory_download", { profileId, repo, path, localPath, overwrite });
