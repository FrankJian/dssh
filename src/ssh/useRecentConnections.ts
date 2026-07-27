import { useCallback, useState } from "react";

const RECENT_KEY = "dssh.recentConnections";
const RECENT_MAX = 12;

function load(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Tracks most-recently-connected profile ids in localStorage. Phase 2 uses this
 * (instead of a backend `last_used_at` column) to power the "recent" section in
 * the Session Manager; a durable backend field can replace it later if needed.
 */
export function useRecentConnections() {
  const [recentIds, setRecentIds] = useState<string[]>(() => load());

  const recordUse = useCallback((profileId: string) => {
    setRecentIds((current) => {
      const next = [profileId, ...current.filter((id) => id !== profileId)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recentIds, recordUse };
}
