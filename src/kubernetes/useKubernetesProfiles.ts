import { useCallback, useEffect, useMemo, useState } from "react";
import type { KubernetesProfile } from "../models";
import {
  createKubernetesProfile,
  deleteKubernetesProfile,
  listKubernetesProfiles,
  setKubernetesProfileFavorite,
  updateKubernetesProfile,
  type CreateKubernetesProfileRequest,
  type UpdateKubernetesProfileRequest,
} from "../services/kubernetesService";

export function useKubernetesProfiles() {
  const [profiles, setProfiles] = useState<KubernetesProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reloadProfiles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setProfiles(await listKubernetesProfiles());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "无法读取 Kubernetes 连接。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    profiles.forEach((profile) => profile.tags.forEach((tag) => tags.add(tag)));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [profiles]);

  async function createProfile(request: CreateKubernetesProfileRequest) {
    const profile = await createKubernetesProfile(request);
    setProfiles((current) => [profile, ...current]);
    return profile;
  }

  async function updateProfile(request: UpdateKubernetesProfileRequest) {
    const profile = await updateKubernetesProfile(request);
    setProfiles((current) => current.map((item) => (item.id === profile.id ? profile : item)));
    return profile;
  }

  async function deleteProfile(id: string) {
    await deleteKubernetesProfile(id);
    setProfiles((current) => current.filter((profile) => profile.id !== id));
  }

  async function toggleFavorite(id: string) {
    const existing = profiles.find((profile) => profile.id === id);
    if (!existing) return;
    const profile = await setKubernetesProfileFavorite(id, !existing.favorite);
    setProfiles((current) => current.map((item) => (item.id === id ? profile : item)));
  }

  return {
    allTags,
    createProfile,
    deleteProfile,
    errorMessage,
    isLoading,
    profiles,
    reloadProfiles,
    toggleFavorite,
    updateProfile,
  };
}
