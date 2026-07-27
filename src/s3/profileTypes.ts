import type { S3CannedAcl, S3Profile } from "../models";

export type S3ProfileEditorMode = "create" | "edit";

export interface S3ProfileDraft {
  name: string;
  host: string;
  port: string;
  useTls: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  forcePathStyle: boolean;
  defaultBucket: string;
  defaultAcl: "" | S3CannedAcl;
  favorite: boolean;
  description: string;
  tags: string;
}

export function createEmptyS3ProfileDraft(): S3ProfileDraft {
  return {
    name: "",
    host: "s3.amazonaws.com",
    port: "443",
    useTls: true,
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    forcePathStyle: false,
    defaultBucket: "",
    defaultAcl: "",
    favorite: false,
    description: "",
    tags: "",
  };
}

export function s3ProfileToDraft(profile: S3Profile): S3ProfileDraft {
  return {
    name: profile.name,
    host: profile.host,
    port: String(profile.port),
    useTls: profile.useTls,
    accessKeyId: profile.accessKeyId,
    secretAccessKey: "",
    sessionToken: "",
    forcePathStyle: profile.forcePathStyle,
    defaultBucket: profile.defaultBucket ?? "",
    defaultAcl: profile.defaultAcl ?? "",
    favorite: profile.favorite,
    description: profile.description ?? "",
    tags: profile.tags.join(", "),
  };
}
