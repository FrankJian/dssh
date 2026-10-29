import { useCallback, useState } from "react";
import { normalizeRecentConnectionsLimit, recentConnectionsLimitKey, RECENT_CONNECTIONS_DEFAULT_LIMIT, RECENT_CONNECTIONS_MAX_LIMIT } from "../settings/settings";

const RECENT_KEY = "dssh.recentConnections";
const RECENT_MAX = RECENT_CONNECTIONS_MAX_LIMIT;

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
  const [displayLimit, setDisplayLimit] = useState(() => {
    const stored = localStorage.getItem(recentConnectionsLimitKey);
    return stored?.trim() ? normalizeRecentConnectionsLimit(Number(stored)) : RECENT_CONNECTIONS_DEFAULT_LIMIT;
  });
  const changeDisplayLimit = useCallback((value: number) => {
    const next = normalizeRecentConnectionsLimit(value);
    localStorage.setItem(recentConnectionsLimitKey, String(next));
    setDisplayLimit(next);
  }, []);

  const recordUse = useCallback((profileId: string) => {
    setRecentIds((current) => {
      const next = [profileId, ...current.filter((id) => id !== profileId)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recentIds, recordUse, displayLimit, setDisplayLimit: changeDisplayLimit };
}
