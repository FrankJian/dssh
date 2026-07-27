import { useCallback, useEffect, useMemo, useState } from "react";
import type { SshProfile } from "../models";
import {
  createSshProfile,
  deleteSshProfile,
  listSshProfiles,
  setSshProfileFavorite,
  updateSshProfile,
} from "../services/sshProfileService";
import {
  createProfileRequestFromDraft,
  updateProfileRequestFromDraft,
} from "./profileStore";
import type { ProfileDraft } from "./profileTypes";

function matchesProfile(profile: SshProfile, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    profile.name,
    profile.host,
    profile.username,
    profile.description ?? "",
    profile.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [query, setQuery] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reloadProfiles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedProfiles = await listSshProfiles();
      setProfiles(loadedProfiles);
      setSelectedProfileId((currentSelectedId) =>
        currentSelectedId && loadedProfiles.some((profile) => profile.id === currentSelectedId)
          ? currentSelectedId
          : (loadedProfiles[0]?.id ?? null),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load SSH profiles.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const filteredProfiles = useMemo(
    () => profiles.filter((profile) => matchesProfile(profile, query)),
    [profiles, query],
  );

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const profile of profiles) {
      for (const tag of profile.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [profiles]);

  async function createProfile(draft: ProfileDraft) {
    const profile = await createSshProfile(createProfileRequestFromDraft(draft));
    setProfiles((currentProfiles) => [profile, ...currentProfiles]);
    setSelectedProfileId(profile.id);
  }

  async function updateProfile(profileId: string, draft: ProfileDraft) {
    const existingProfile = profiles.find((profile) => profile.id === profileId);
    if (!existingProfile) {
      return;
    }

    const updatedProfile = await updateSshProfile(
      updateProfileRequestFromDraft(existingProfile, draft),
    );
    setProfiles((currentProfiles) =>
      currentProfiles.map((profile) =>
        profile.id === profileId ? updatedProfile : profile,
      ),
    );
    setSelectedProfileId(profileId);
  }

  async function deleteProfile(profileId: string) {
    await deleteSshProfile(profileId);
    setProfiles((currentProfiles) => {
      const nextProfiles = currentProfiles.filter((profile) => profile.id !== profileId);
      setSelectedProfileId((currentSelectedId) =>
        currentSelectedId === profileId ? (nextProfiles[0]?.id ?? null) : currentSelectedId,
      );
      return nextProfiles;
    });
  }

  async function toggleFavorite(profileId: string) {
    const existingProfile = profiles.find((profile) => profile.id === profileId);
    if (!existingProfile) {
      return;
    }

    const updatedProfile = await setSshProfileFavorite(profileId, !existingProfile.favorite);
    setProfiles((currentProfiles) =>
      currentProfiles.map((profile) =>
        profile.id === profileId ? updatedProfile : profile,
      ),
    );
  }

  return {
    allTags,
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
