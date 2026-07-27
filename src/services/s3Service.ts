import { listen } from "@tauri-apps/api/event";
import type {
  S3Bucket,
  S3Bookmark,
  S3CannedAcl,
  S3CleanupPreview,
  S3ObjectListing,
  S3Profile,
} from "../models";
import { invokeCommand } from "./tauri";

export interface CreateS3ProfileRequest {
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
  defaultBucket?: string;
  defaultAcl?: S3CannedAcl;
  favorite: boolean;
  description?: string;
  tags: string[];
}

export interface UpdateS3ProfileRequest
  extends Omit<CreateS3ProfileRequest, "secretAccessKey"> {
  id: string;
  secretAccessKey?: string;
}

export interface ListS3ObjectsRequest {
  profileId: string;
  bucket: string;
  prefix: string;
  continuationToken?: string;
  maxKeys?: number;
}

export interface S3TransferProgress {
  profileId: string;
  operation: "upload" | "download";
  bucket: string;
  key: string;
  transferred: number;
  total: number | null;
  done: boolean;
}

export const S3_TRANSFER_PROGRESS_EVENT = "s3://transfer-progress";

export function onS3TransferProgress(handler: (progress: S3TransferProgress) => void) {
  return listen<S3TransferProgress>(S3_TRANSFER_PROGRESS_EVENT, (event) =>
    handler(event.payload),
  );
}

export function listS3Profiles() {
  return invokeCommand<S3Profile[]>("list_s3_profiles");
}

export function createS3Profile(request: CreateS3ProfileRequest) {
  return invokeCommand<S3Profile>("create_s3_profile", { request });
}

export function updateS3Profile(request: UpdateS3ProfileRequest) {
  return invokeCommand<S3Profile>("update_s3_profile", { request });
}

export function deleteS3Profile(id: string) {
  return invokeCommand<void>("delete_s3_profile", { id });
}

export function listS3Bookmarks(profileId: string) {
  return invokeCommand<S3Bookmark[]>("list_s3_bookmarks", { profileId });
}

export function createS3Bookmark(
  profileId: string,
  name: string,
  bucket: string,
  prefix: string,
) {
  return invokeCommand<S3Bookmark>("create_s3_bookmark", {
    profileId,
    name,
    bucket,
    prefix,
  });
}

export function deleteS3Bookmark(profileId: string, id: string) {
  return invokeCommand<void>("delete_s3_bookmark", { profileId, id });
}

export function testSavedS3Profile(profileId: string) {
  return invokeCommand<void>("test_s3_profile", { profileId });
}

export function testS3Connection(request: CreateS3ProfileRequest) {
  return invokeCommand<void>("test_s3_connection", { request });
}

export function setS3ProfileFavorite(id: string, favorite: boolean) {
  return invokeCommand<S3Profile>("set_s3_profile_favorite", { id, favorite });
}

export function listS3Buckets(profileId: string) {
  return invokeCommand<S3Bucket[]>("s3_list_buckets", { profileId });
}

export function listS3Objects(request: ListS3ObjectsRequest) {
  return invokeCommand<S3ObjectListing>("s3_list_objects", { ...request });
}

export function uploadS3Object(
  profileId: string,
  bucket: string,
  key: string,
  localPath: string,
  acl?: S3CannedAcl,
) {
  return invokeCommand<void>("s3_upload", { profileId, bucket, key, localPath, acl });
}

export function downloadS3Object(
  profileId: string,
  bucket: string,
  key: string,
  localPath: string,
) {
  return invokeCommand<void>("s3_download", { profileId, bucket, key, localPath });
}

export function downloadS3Prefix(
  profileId: string,
  bucket: string,
  prefix: string,
  localDirectory: string,
  concurrency: number,
) {
  return invokeCommand<number>("s3_download_prefix", {
    profileId,
    bucket,
    prefix,
    localDirectory,
    concurrency,
  });
}

export function createS3Folder(profileId: string, bucket: string, key: string) {
  return invokeCommand<void>("s3_create_folder", { profileId, bucket, key });
}

export function deleteS3Object(
  profileId: string,
  bucket: string,
  key: string,
  recursive = false,
) {
  return invokeCommand<number>("s3_delete", { profileId, bucket, key, recursive });
}

export function previewS3Cleanup(
  profileId: string,
  bucket: string,
  prefix: string,
  cutoffTimestamp: number,
) {
  return invokeCommand<S3CleanupPreview>("s3_cleanup_preview", {
    profileId,
    bucket,
    prefix,
    cutoffTimestamp,
  });
}

export function deleteS3CleanupObjects(
  profileId: string,
  bucket: string,
  prefix: string,
  keys: string[],
) {
  return invokeCommand<number>("s3_cleanup_delete", { profileId, bucket, prefix, keys });
}

export function copyS3Object(
  profileId: string,
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string,
  recursive = false,
) {
  return invokeCommand<number>("s3_copy", {
    profileId,
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    recursive,
  });
}

export function moveS3Object(
  profileId: string,
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string,
  recursive = false,
) {
  return invokeCommand<number>("s3_move", {
    profileId,
    sourceBucket,
    sourceKey,
    destinationBucket,
    destinationKey,
    recursive,
  });
}

export function setS3ObjectAcl(
  profileId: string,
  bucket: string,
  key: string,
  acl: S3CannedAcl,
) {
  return invokeCommand<void>("s3_set_canned_acl", { profileId, bucket, key, acl });
}

export function getS3ObjectAcl(profileId: string, bucket: string, key: string) {
  return invokeCommand<S3CannedAcl>("s3_get_canned_acl", { profileId, bucket, key });
}
