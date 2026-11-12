import type { BrowserEntry, BrowserSide } from "./fileBrowserModel.ts";

export type FileSearchScope = "directory" | "depth" | "subdirectories";

function compileFileMatcher(query: string): (value: string) => boolean {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => ({ term, characters: [...term] }));
  return (value) => {
    const text = value.normalize("NFKC").toLocaleLowerCase();
    return terms.every(({ term, characters }) => {
      if (text.includes(term)) return true;
      let index = 0;
      for (const char of text) {
        if (char === characters[index]) index += 1;
        if (index === characters.length) return true;
      }
      return false;
    });
  };
}
export function fuzzyFileMatch(value: string, query: string): boolean {
  return compileFileMatcher(query)(value);
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
  return relativePathMatcher(root, side)(path);
}

function relativePathMatcher(root: string, side: BrowserSide) {
  const windows =
    side === "local" && (/^[a-z]:[\\/]/i.test(root) || root.startsWith("\\\\"));
  const prefix = `${normalized(root, side).replace(/\/+$/, "")}/`;
  const comparisonPrefix = windows ? prefix.toLowerCase() : prefix;
  return (path: string): string | null => {
    const value = normalized(path, side);
    return (windows ? value.toLowerCase() : value).startsWith(comparisonPrefix)
      ? value.slice(prefix.length) || null
      : null;
  };
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
  /** Number of subdirectory levels to enter. The current directory is level 0. */
  maxDepth?: number | null;
  onProgress?: (progress: SearchProgress) => void;
  limits?: { directories: number; entries: number; results: number };
}
const PARALLEL_LISTINGS = 4;
const PROGRESS_INTERVAL_MS = 80;

export async function recursiveFileSearch(
  options: SearchOptions,
): Promise<SearchProgress> {
  const { root, rootEntries, side, query, showHidden, list, signal } = options;
  const maxDepth = options.maxDepth ?? Infinity;
  const matches = compileFileMatcher(query);
  const relativeToRoot = relativePathMatcher(root, side);
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
  const pending = [{ path: root, depth: 0 }];
  const seen = new Set([root]);
  const matched = new Set<string>();
  const inFlight = new Map<number, Promise<{ entries: BrowserEntry[] } | { error: unknown }>>();
  let nextRead = 0;
  let lastPublished = -Infinity;
  async function read(path: string) {
    try {
      return { entries: path === root ? rootEntries : await list(path) };
    } catch (error) {
      return { error };
    }
  }
  function publish() {
    const now = Date.now();
    if (!options.onProgress || signal.aborted || now - lastPublished < PROGRESS_INTERVAL_MS) return;
    lastPublished = now;
    options.onProgress({ ...result, entries: [...result.entries] });
  }
  for (let index = 0; index < pending.length; index += 1) {
    if (signal.aborted) break;
    if (result.directories >= limit.directories) {
      result.limited = true;
      break;
    }
    // Overlap the network reads while consuming them in breadth-first order.
    // Each promise handles its error even if the search stops before using it.
    while (!signal.aborted && nextRead < Math.min(pending.length, index + PARALLEL_LISTINGS, limit.directories)) {
      inFlight.set(nextRead, read(pending[nextRead].path));
      nextRead += 1;
    }
    if (signal.aborted) break;
    const listing = await inFlight.get(index)!;
    inFlight.delete(index);
    if (signal.aborted) break;
    result.directories += 1;
    if ("error" in listing) {
      result.skipped += 1;
      result.error ??=
        listing.error instanceof Error ? listing.error.message : "部分目录无法读取。";
      publish();
      continue;
    }
    const childDepth = pending[index].depth + 1;
    for (const entry of listing.entries) {
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
        publish();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) break;
      }
      if (
        entry.name === "." ||
        entry.name === ".." ||
        (!showHidden && entry.name.startsWith("."))
      )
        continue;
      const relative = relativeToRoot(entry.path);
      if (relative === null) continue;
      if (matches(relative) && !matched.has(entry.path)) {
        matched.add(entry.path);
        result.entries.push(entry);
      }
      if (
        childDepth <= maxDepth &&
        pending.length <= limit.directories &&
        entry.isDir && !entry.isSymlink && !seen.has(entry.path)
      ) {
        seen.add(entry.path);
        pending.push({ path: entry.path, depth: childDepth });
      }
    }
    publish();
    if (result.limited) break;
  }
  result.cancelled = signal.aborted;
  return result;
}
