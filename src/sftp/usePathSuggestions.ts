import { useEffect, useRef, useState } from "react";
import { addressText, directorySuggestionQuery } from "./browserPaths";
import type { BrowserEntry } from "./fileBrowserModel";

const MAX_SUGGESTIONS = 8;
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function usePathSuggestions(
  editing: boolean,
  input: string,
  currentPath: string,
  windows: boolean,
  resolve: (input: string, currentPath: string) => Promise<string>,
  list: (path: string) => Promise<BrowserEntry[]>,
) {
  const [result, setResult] = useState<{ input: string; currentPath: string; list: typeof list; entries: BrowserEntry[] }>();
  const cached = useRef<{ directory: string; list: typeof list; entries: Promise<BrowserEntry[]> } | undefined>(undefined);

  useEffect(() => {
    if (!editing) {
      cached.current = undefined;
      setResult(undefined);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const value = addressText(input);
        if (!value) return;
        const current = input === currentPath;
        const path = current ? currentPath : await resolve(input, currentPath);
        if (cancelled) return;
        const { directory, prefix } = directorySuggestionQuery(path, windows, current || value === "~");
        const previous = cached.current;
        const request = previous?.directory === directory && previous.list === list
          ? previous
          : { directory, list, entries: list(directory) };
        cached.current = request;
        let entries: BrowserEntry[];
        try {
          entries = await request.entries;
        } catch (error) {
          if (cached.current === request) cached.current = undefined;
          throw error;
        }
        if (cancelled) return;
        const lowerPrefix = prefix.toLowerCase();
        setResult({
          input,
          currentPath,
          list,
          entries: entries.filter((entry) =>
            entry.isDir &&
            (prefix.startsWith(".") || !entry.name.startsWith(".")) &&
            entry.name.toLowerCase().startsWith(lowerPrefix),
          ).sort((a, b) => naturalOrder.compare(a.name, b.name)).slice(0, MAX_SUGGESTIONS),
        });
      } catch {
        // Completion is optional. Submitting an invalid path still reports
        // the normal navigation error in the pane.
      }
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editing, input, currentPath, windows, resolve, list]);

  return editing && result?.input === input && result.currentPath === currentPath && result.list === list
    ? result.entries
    : [];
}
