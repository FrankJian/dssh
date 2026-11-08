import type { BrowserEntry, BrowserSide } from "./fileBrowserModel.ts";

export function fuzzyFileMatch(value: string, query: string): boolean {
  const text = value.normalize("NFKC").toLocaleLowerCase();
  return query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => {
      const characters = [...term];
      let index = 0;
      for (const char of text) {
        if (char === characters[index]) index += 1;
        if (index === characters.length) return true;
      }
      return false;
    });
}
function normalized(path: string, side: BrowserSide) {
  return side === "local" &&
    (/^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\"))
    ? path.replace(/\\/g, "/")
    : path;
}
export function relativeSearchPath(
  path: string,
  root: string,
  side: BrowserSide,
): string | null {
  const directory = normalized(root, side).replace(/\/+$/, "");
  const value = normalized(path, side);
  const windows =
    side === "local" && (/^[a-z]:[\\/]/i.test(root) || root.startsWith("\\\\"));
  const prefix = `${directory}/`;
  return (
    windows
      ? value.toLowerCase().startsWith(prefix.toLowerCase())
      : value.startsWith(prefix)
  )
    ? value.slice(prefix.length) || null
    : null;
}

/** Flattening search results must not duplicate a selected directory's children. */
export function topLevelSelection<T extends BrowserEntry>(
  entries: T[],
  side: BrowserSide,
): T[] {
  const unique = [
    ...new Map(entries.map((entry) => [entry.path, entry])).values(),
  ];
  return unique.filter(
    (entry) =>
      !unique.some(
        (parent) =>
          parent !== entry &&
          parent.isDir &&
          !parent.isSymlink &&
          relativeSearchPath(entry.path, parent.path, side) !== null,
      ),
  );
}
export interface SearchProgress {
  entries: BrowserEntry[];
  directories: number;
  scanned: number;
  skipped: number;
  error: string | null;
  limited: boolean;
  cancelled: boolean;
}
interface SearchOptions {
  root: string;
  rootEntries: BrowserEntry[];
  side: BrowserSide;
  query: string;
  showHidden: boolean;
  list: (path: string) => Promise<BrowserEntry[]>;
  signal: AbortSignal;
  onProgress?: (progress: SearchProgress) => void;
  limits?: { directories: number; entries: number; results: number };
}
export async function recursiveFileSearch(
  options: SearchOptions,
): Promise<SearchProgress> {
  const { root, rootEntries, side, query, showHidden, list, signal } = options;
  const limit = options.limits ?? {
    directories: 2000,
    entries: 100000,
    results: 2000,
  };
  const result: SearchProgress = {
    entries: [],
    directories: 0,
    scanned: 0,
    skipped: 0,
    error: null,
    limited: false,
    cancelled: false,
  };
  const pending = [root];
  const seen = new Set([root]);
  const matched = new Set<string>();
  for (let index = 0; index < pending.length; index += 1) {
    if (signal.aborted) break;
    if (result.directories >= limit.directories) {
      result.limited = true;
      break;
    }
    const path = pending[index];
    let entries: BrowserEntry[];
    try {
      entries = index === 0 ? rootEntries : await list(path);
    } catch (reason) {
      if (signal.aborted) break;
      result.skipped += 1;
      result.error ??=
        reason instanceof Error ? reason.message : "部分目录无法读取。";
      result.directories += 1;
      options.onProgress?.({ ...result, entries: [...result.entries] });
      continue;
    }
    if (signal.aborted) break;
    result.directories += 1;
    for (const entry of entries) {
      if (signal.aborted) break;
      if (
        result.scanned >= limit.entries ||
        result.entries.length >= limit.results
      ) {
        result.limited = true;
        break;
      }
      result.scanned += 1;
      // A single very large listing must still let Stop/input events run.
      if (result.scanned % 500 === 0) {
        options.onProgress?.({ ...result, entries: [...result.entries] });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) break;
      }
      if (
        entry.name === "." ||
        entry.name === ".." ||
        (!showHidden && entry.name.startsWith("."))
      )
        continue;
      const relative = relativeSearchPath(entry.path, root, side);
      if (relative === null) continue;
      if (fuzzyFileMatch(relative, query) && !matched.has(entry.path)) {
        matched.add(entry.path);
        result.entries.push(entry);
      }
      if (entry.isDir && !entry.isSymlink && !seen.has(entry.path)) {
        seen.add(entry.path);
        pending.push(entry.path);
      }
    }
    options.onProgress?.({ ...result, entries: [...result.entries] });
    if (result.limited) break;
  }
  result.cancelled = signal.aborted;
  return result;
}
