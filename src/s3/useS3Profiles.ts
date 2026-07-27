import { useCallback, useEffect, useMemo, useState } from "react";
import type { S3Profile } from "../models";
import {
  createS3Profile,
  deleteS3Profile,
  listS3Profiles,
  setS3ProfileFavorite,
  updateS3Profile,
} from "../services/s3Service";
import type { S3ProfileDraft } from "./profileTypes";

function requestFromDraft(draft: S3ProfileDraft) {
  return {
    name: draft.name.trim(),
    host: draft.host.trim(),
    port: Number.parseInt(draft.port, 10),
    useTls: draft.useTls,
    accessKeyId: draft.accessKeyId.trim(),
    secretAccessKey: draft.secretAccessKey,
    sessionToken: draft.sessionToken.trim() || undefined,
    forcePathStyle: draft.forcePathStyle,
    defaultBucket: draft.defaultBucket.trim() || undefined,
    defaultAcl: draft.defaultAcl || undefined,
    favorite: draft.favorite,
    description: draft.description.trim() || undefined,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export function useS3Profiles() {
  const [profiles, setProfiles] = useState<S3Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reloadProfiles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await listS3Profiles();
      setProfiles(loaded);
      setSelectedProfileId((id) =>
        id && loaded.some((profile) => profile.id === id) ? id : (loaded[0]?.id ?? null),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载 S3 配置失败。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? profiles.filter((profile) =>
          [profile.name, profile.host, String(profile.port), profile.description ?? "", ...profile.tags]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : profiles;
  }, [profiles, query]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  async function createProfile(draft: S3ProfileDraft) {
    const profile = await createS3Profile(requestFromDraft(draft));
    setProfiles((current) => [profile, ...current]);
    setSelectedProfileId(profile.id);
  }

  async function updateProfile(id: string, draft: S3ProfileDraft) {
    const profile = await updateS3Profile({ id, ...requestFromDraft(draft) });
    setProfiles((current) => current.map((item) => (item.id === id ? profile : item)));
  }

  async function deleteProfile(id: string) {
    await deleteS3Profile(id);
    setProfiles((current) => {
      const next = current.filter((profile) => profile.id !== id);
      setSelectedProfileId((selected) =>
        selected === id ? (next[0]?.id ?? null) : selected,
      );
      return next;
    });
  }

  async function toggleFavorite(id: string) {
    const current = profiles.find((profile) => profile.id === id);
    if (!current) return;
    const profile = await setS3ProfileFavorite(id, !current.favorite);
    setProfiles((items) => items.map((item) => (item.id === id ? profile : item)));
  }

  return {
    createProfile,
    deleteProfile,
    errorMessage,
    filteredProfiles,
    isLoading,
    profiles,
    query,
    reloadProfiles,
    selectedProfile,
    selectedProfileId,
    setQuery,
    setSelectedProfileId,
    toggleFavorite,
    updateProfile,
  };
}
