import { useCallback, useState } from "react";

export type SplitDir = "h" | "v";
export const MAX_PANES = 4;

/**
 * A flat split layout: 2–4 terminal sessions arranged in a single row (`h`) or
 * column (`v`), with per-pane size ratios. Nested splits are intentionally out
 * of scope for now — this covers the common "see a few terminals at once" case
 * and keeps the model simple and robust. `null` means no split (single view).
 */
export interface PaneLayout {
  dir: SplitDir;
  sessionIds: string[];
  ratios: number[];
}

function equalRatios(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

export function usePaneLayout() {
  const [layout, setLayout] = useState<PaneLayout | null>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  const paneCount = layout ? layout.sessionIds.length : 0;
  const canSplit = paneCount === 0 || paneCount < MAX_PANES;

  /** Split the current view: from single (currentId) or append to an existing split. */
  const split = useCallback((dir: SplitDir, currentId: string, newSessionId: string) => {
    setLayout((current) => {
      if (!current) {
        return { dir, sessionIds: [currentId, newSessionId], ratios: equalRatios(2) };
      }
      if (current.sessionIds.length >= MAX_PANES || current.sessionIds.includes(newSessionId)) {
        return current;
      }
      const sessionIds = [...current.sessionIds, newSessionId];
      return { dir: current.dir, sessionIds, ratios: equalRatios(sessionIds.length) };
    });
    setFocusedPaneId(newSessionId);
  }, []);

  /** Remove a pane; collapses back to single view (returns null) when ≤1 remains. */
  const removePane = useCallback((sessionId: string) => {
    setLayout((current) => {
      if (!current) {
        return null;
      }
      const sessionIds = current.sessionIds.filter((id) => id !== sessionId);
      if (sessionIds.length <= 1) {
        return null;
      }
      return { dir: current.dir, sessionIds, ratios: equalRatios(sessionIds.length) };
    });
    setFocusedPaneId((current) => (current === sessionId ? null : current));
  }, []);

  const focusPane = useCallback((sessionId: string) => {
    setFocusedPaneId(sessionId);
  }, []);

  const setRatios = useCallback((ratios: number[]) => {
    setLayout((current) => (current ? { ...current, ratios } : current));
  }, []);

  const resetPanes = useCallback(() => {
    setLayout(null);
    setFocusedPaneId(null);
  }, []);

  return {
    layout,
    focusedPaneId,
    paneCount,
    canSplit,
    split,
    removePane,
    focusPane,
    setRatios,
    resetPanes,
  };
}
