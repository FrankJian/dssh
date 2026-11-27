import type { ActivityId, NavigationIconId } from "./ActivityBar";

const ACTIVITIES: readonly string[] = ["sessions", "connections", "tools", "sftp", "s3", "artifactory"];
const OTHER_ICONS: readonly string[] = ["editor", "browser", "assistant", "newLocalTerminal"];

export const DEFAULT_NAVIGATION_ICONS: NavigationIconId[] = ["sessions", "connections", "tools", "editor", "assistant"];

export function isActivityId(value: string): value is ActivityId {
  return ACTIVITIES.includes(value);
}

/** Workspace content remains reachable even when its activity-rail icon is hidden. */
export function navigationActivityFallback(active: ActivityId, icons: readonly NavigationIconId[]): ActivityId | null {
  if (active === "sessions" || active === "tools" || icons.includes(active)) return null;
  return icons.find((id): id is ActivityId => isActivityId(id) && id !== "tools") ?? null;
}

export function parseNavigationIcons(raw: string | null, migrateTools = false): NavigationIconId[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [...DEFAULT_NAVIGATION_ICONS];
    const unique = [...new Set(parsed.filter((value): value is NavigationIconId =>
      typeof value === "string" && (isActivityId(value) || OTHER_ICONS.includes(value)),
    ))];
    if (!unique.some(isActivityId)) return [...DEFAULT_NAVIGATION_ICONS];
    if (migrateTools && !unique.includes("tools")) {
      unique.splice(unique.indexOf("connections") + 1, 0, "tools");
    }
    return unique;
  } catch {
    return [...DEFAULT_NAVIGATION_ICONS];
  }
}
