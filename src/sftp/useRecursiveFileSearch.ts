import { useEffect, useRef, useState } from "react";
import type { BrowserEntry, BrowserSide } from "./fileBrowserModel";
import { recursiveFileSearch, type SearchProgress } from "./recursiveSearch";

export type RecursiveSearchStatus =
  | "idle"
  | "pending"
  | "searching"
  | "complete"
  | "cancelled"
  | "limited"
  | "error";
const empty: SearchProgress = {
  entries: [],
  directories: 0,
  scanned: 0,
  skipped: 0,
  error: null,
  limited: false,
  cancelled: false,
};
interface Options {
  root: string;
  rootEntries: BrowserEntry[];
  side: BrowserSide;
  query: string;
  showHidden: boolean;
  enabled: boolean;
  list: (path: string) => Promise<BrowserEntry[]>;
}
export function useRecursiveFileSearch(options: Options) {
  const { root, rootEntries, side, query, showHidden, enabled, list } = options;
  const controller = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([root, query, showHidden, enabled, revision]);
  const [state, setState] = useState<
    SearchProgress & { key: string; status: RecursiveSearchStatus }
  >({ ...empty, key, status: "idle" });
  const active = enabled && Boolean(root && query.trim());
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    if (!active) {
      setState({ ...empty, key, status: "idle" });
      return () => abort.abort();
    }
    setState({ ...empty, key, status: "pending" });
    const timer = window.setTimeout(() => {
      if (abort.signal.aborted) return;
      let published = 0;
      setState({ ...empty, key, status: "searching" });
      void recursiveFileSearch({
        root,
        rootEntries,
        side,
        query,
        showHidden,
        list,
        signal: abort.signal,
        onProgress: (progress) => {
          if (!abort.signal.aborted && Date.now() - published >= 80) {
            published = Date.now();
            setState({ ...progress, key, status: "searching" });
          }
        },
      })
        .then((progress) => {
          if (!abort.signal.aborted)
            setState({
              ...progress,
              key,
              status: progress.limited ? "limited" : "complete",
            });
        })
        .catch((reason: unknown) => {
          if (!abort.signal.aborted)
            setState((current) => ({
              ...current,
              key,
              status: "error",
              error: reason instanceof Error ? reason.message : "搜索失败。",
            }));
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [active, root, rootEntries, side, query, showHidden, list, key]);
  function cancel() {
    controller.current?.abort();
    setState((current) => ({
      ...current,
      cancelled: true,
      status: "cancelled",
    }));
  }
  return {
    ...(state.key === key
      ? state
      : {
          ...empty,
          key,
          status: active ? ("pending" as const) : ("idle" as const),
        }),
    active,
    cancel,
    restart: () => setRevision((current) => current + 1),
  };
}
