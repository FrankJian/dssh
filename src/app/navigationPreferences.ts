import type { NavigationIconId } from './ActivityBar';
export const DEFAULT_NAVIGATION_ICONS: NavigationIconId[] = ['sessions','connections','assistant'];
export function parseNavigationIcons(raw: string | null): NavigationIconId[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [...DEFAULT_NAVIGATION_ICONS];
    const allowed = new Set(['sessions','connections','sftp','s3','browser','assistant','newLocalTerminal']);
    const unique = [...new Set(parsed.filter((value): value is NavigationIconId => typeof value === 'string' && allowed.has(value)))];
    if (!unique.some(value => ['sessions','connections','sftp','s3'].includes(value))) return [...DEFAULT_NAVIGATION_ICONS];
    return unique;
  } catch { return [...DEFAULT_NAVIGATION_ICONS]; }
}
