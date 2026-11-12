export interface BrowserEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
}
export type SortKey = "name" | "size" | "modified";
export type BrowserSide = "remote" | "local";

const fileNameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function visibleEntries<T extends BrowserEntry>(
  entries: T[],
  query: string,
  hidden: boolean,
  key: SortKey,
  descending: boolean,
): T[] {
  const search = query.trim().toLocaleLowerCase();
  return entries
    .filter(
      (entry) =>
        (hidden || !entry.name.startsWith(".")) &&
        (!search || entry.name.toLocaleLowerCase().includes(search)),
    )
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      const order = key === "size"
        ? a.size - b.size
        : key === "modified"
          ? (a.modified ?? 0) - (b.modified ?? 0)
          : 0;
      return (order || fileNameOrder.compare(a.name, b.name)) * (descending ? -1 : 1);
    });
}

export function rangeSelection(
  entries: BrowserEntry[],
  anchor: string,
  target: string,
): string[] {
  const start = entries.findIndex((entry) => entry.path === anchor);
  const end = entries.findIndex((entry) => entry.path === target);
  return start < 0 || end < 0
    ? [target]
    : entries
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .map((entry) => entry.path);
}

export interface DirectoryHistory {
  paths: string[];
  index: number;
}
export function visitDirectory(
  history: DirectoryHistory,
  path: string,
): DirectoryHistory {
  if (history.paths[history.index] === path) return history;
  return {
    paths: [...history.paths.slice(0, history.index + 1), path].slice(-100),
    index: Math.min(history.index + 1, 99),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}
