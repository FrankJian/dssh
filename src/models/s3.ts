export interface S3Profile {
  id: string;
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  accessKeyId: string;
  forcePathStyle: boolean;
  defaultBucket?: string;
  defaultAcl?: S3CannedAcl;
  favorite: boolean;
  description?: string;
  tags: string[];
  hasSecretAccessKey: boolean;
  hasSessionToken: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface S3Bucket {
  name: string;
  creationDate?: number;
}

export interface S3Bookmark {
  id: string;
  profileId: string;
  name: string;
  bucket: string;
  prefix: string;
  createdAt: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: number;
  etag?: string;
  storageClass?: string;
}

export interface S3ObjectListing {
  bucket: string;
  prefix: string;
  folders: string[];
  objects: S3Object[];
  nextContinuationToken?: string;
}

export interface S3CleanupObject {
  key: string;
  size: number;
  lastModified: number;
}

export interface S3CleanupPreview {
  objects: S3CleanupObject[];
  totalSize: number;
  exceededLimit: boolean;
}

export type S3CannedAcl =
  | "private"
  | "public-read"
  | "public-read-write"
  | "authenticated-read";
