import type { SshProfile } from "../models";

interface TaggableProfile {
  favorite: boolean;
  tags: string[];
}

export interface ProfileGroup<T extends TaggableProfile = SshProfile> {
  key: string;
  label: string;
  profiles: T[];
}

export const FAVORITES_KEY = "__favorites__";
export const UNTAGGED_KEY = "__untagged__";

/**
 * Groups saved connection profiles into Favorites → per-tag → Untagged
 * sections. Shared by the saved-connections list, the connection manager,
 * and the legacy ProfileSidebar so all views stay in sync.
 */
export function groupProfiles<T extends TaggableProfile>(profiles: T[]): ProfileGroup<T>[] {
  const favorites = profiles.filter((profile) => profile.favorite);

  const tags = new Set<string>();
  for (const profile of profiles) {
    for (const tag of profile.tags) {
      tags.add(tag);
    }
  }
  const sortedTags = Array.from(tags).sort((a, b) => a.localeCompare(b));

  const groups: ProfileGroup<T>[] = [];

  if (favorites.length > 0) {
    groups.push({ key: FAVORITES_KEY, label: "收藏", profiles: favorites });
  }

  // Tag groups list every profile that carries the tag, including favorites,
  // so a favorite still shows up under each of its tags.
  for (const tag of sortedTags) {
    groups.push({
      key: `tag:${tag}`,
      label: tag,
      profiles: profiles.filter((profile) => profile.tags.includes(tag)),
    });
  }

  // Untagged only collects non-favorite profiles; favorite untagged ones are
  // already represented in the 收藏 group.
  const untagged = profiles.filter((profile) => profile.tags.length === 0 && !profile.favorite);
  if (untagged.length > 0) {
    groups.push({ key: UNTAGGED_KEY, label: "未分组", profiles: untagged });
  }

  return groups;
}
