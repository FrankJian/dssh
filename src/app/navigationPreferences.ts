import type { ActivityId, NavigationIconId } from "./ActivityBar";

const ACTIVITIES: readonly string[] = ["sessions", "connections", "tools", "sftp", "s3", "artifactory"];
const OTHER_ICONS: readonly string[] = ["browser", "assistant", "newLocalTerminal"];

export const DEFAULT_NAVIGATION_ICONS: NavigationIconId[] = ["sessions", "connections", "tools", "assistant"];

export function isActivityId(value: string): value is ActivityId {
  return ACTIVITIES.includes(value);
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
