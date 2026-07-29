import { useCallback, useRef, useState } from "react";

export type SplitDir = "h" | "v";
export const MAX_PANES = 4;

export interface PaneLeaf {
  type: "leaf";
  sessionId: string;
}

export interface PaneSplit {
  type: "split";
  id: string;
  dir: SplitDir;
  children: [PaneNode, PaneNode];
  ratios: [number, number];
}

export type PaneNode = PaneLeaf | PaneSplit;

/** One terminal-window's independent pane tree. */
export interface PaneLayout {
  tabSessionId: string;
  focusedPaneId: string;
  root: PaneSplit;
}

export function paneSessionIds(node: PaneNode | PaneLayout | null): string[] {
  if (!node) return [];
  if ("root" in node) return paneSessionIds(node.root);
  return node.type === "leaf"
    ? [node.sessionId]
    : [...paneSessionIds(node.children[0]), ...paneSessionIds(node.children[1])];
}

function replaceLeaf(node: PaneNode, sessionId: string, replacement: PaneNode): PaneNode {
  if (node.type === "leaf") return node.sessionId === sessionId ? replacement : node;
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], sessionId, replacement),
      replaceLeaf(node.children[1], sessionId, replacement),
    ],
  };
}

function removeLeaf(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") return node.sessionId === sessionId ? null : node;
  const first = removeLeaf(node.children[0], sessionId);
  const second = removeLeaf(node.children[1], sessionId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, children: [first, second] };
}

function setSplitRatios(node: PaneNode, splitId: string, ratios: [number, number]): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, ratios };
  return {
    ...node,
    children: [
      setSplitRatios(node.children[0], splitId, ratios),
      setSplitRatios(node.children[1], splitId, ratios),
    ],
  };
}

/**
 * Terminal windows own their pane trees independently, mirroring tmux's
 * window/pane relationship. A session that is not in a layout is an ordinary
 * single-pane terminal window.
 */
export function usePaneLayout() {
  const [layouts, setLayouts] = useState<PaneLayout[]>([]);
  const splitCounter = useRef(0);

  const findLayout = useCallback(
    (sessionId: string | null) => sessionId
      ? layouts.find((layout) => paneSessionIds(layout).includes(sessionId)) ?? null
      : null,
    [layouts],
  );

  const findLayoutByTab = useCallback(
    (tabSessionId: string) => layouts.find((layout) => layout.tabSessionId === tabSessionId) ?? null,
    [layouts],
  );

  const canSplit = useCallback(
    (sessionId: string | null) => sessionId ? paneSessionIds(findLayout(sessionId)).length < MAX_PANES : false,
    [findLayout],
  );

  const split = useCallback((dir: SplitDir, currentId: string, newSessionId: string) => {
    const makeSplit = (first: PaneNode): PaneSplit => ({
      type: "split",
      id: `split-${++splitCounter.current}`,
      dir,
      children: [first, { type: "leaf", sessionId: newSessionId }],
      ratios: [0.5, 0.5],
    });
    setLayouts((current) => {
      const index = current.findIndex((layout) => paneSessionIds(layout).includes(currentId));
      if (index < 0) {
        return [...current, {
          tabSessionId: currentId,
          focusedPaneId: newSessionId,
          root: makeSplit({ type: "leaf", sessionId: currentId }),
        }];
      }
      const layout = current[index];
      if (paneSessionIds(layout).length >= MAX_PANES || paneSessionIds(layout).includes(newSessionId)) {
        return current;
      }
      const next = [...current];
      next[index] = {
        ...layout,
        focusedPaneId: newSessionId,
        root: replaceLeaf(layout.root, currentId, makeSplit({ type: "leaf", sessionId: currentId })) as PaneSplit,
      };
      return next;
    });
  }, []);

  /** Remove one pane, collapsing its window back to an ordinary terminal when one remains. */
  const removePane = useCallback((sessionId: string) => {
    setLayouts((current) => {
      const index = current.findIndex((layout) => paneSessionIds(layout).includes(sessionId));
      if (index < 0) return current;
      const layout = current[index];
      const root = removeLeaf(layout.root, sessionId);
      if (root?.type !== "split") {
        return current.filter((_, layoutIndex) => layoutIndex !== index);
      }
      const remaining = paneSessionIds(root);
      const next = [...current];
      next[index] = {
        ...layout,
        root,
        tabSessionId: remaining.includes(layout.tabSessionId) ? layout.tabSessionId : remaining[0]!,
        focusedPaneId: layout.focusedPaneId === sessionId ? remaining[0]! : layout.focusedPaneId,
      };
      return next;
    });
  }, []);

  const removeLayout = useCallback((tabSessionId: string) => {
    setLayouts((current) => current.filter((layout) => layout.tabSessionId !== tabSessionId));
  }, []);

  const focusPane = useCallback((sessionId: string) => {
    setLayouts((current) => current.map((layout) =>
      paneSessionIds(layout).includes(sessionId) ? { ...layout, focusedPaneId: sessionId } : layout,
    ));
  }, []);

  const setRatios = useCallback((splitId: string, ratios: [number, number]) => {
    setLayouts((current) => current.map((layout) => ({
      ...layout,
      root: setSplitRatios(layout.root, splitId, ratios) as PaneSplit,
    })));
  }, []);

  /** Keep layouts coherent when a session is closed outside the pane UI. */
  const pruneSessions = useCallback((liveSessionIds: Set<string>) => {
    setLayouts((current) => current.flatMap((layout) => {
      let root: PaneNode | null = layout.root;
      for (const sessionId of paneSessionIds(layout)) {
        if (!liveSessionIds.has(sessionId) && root) root = removeLeaf(root, sessionId);
      }
      if (root?.type !== "split") return [];
      const remaining = paneSessionIds(root);
      return [{
        ...layout,
        root,
        tabSessionId: remaining.includes(layout.tabSessionId) ? layout.tabSessionId : remaining[0]!,
        focusedPaneId: remaining.includes(layout.focusedPaneId) ? layout.focusedPaneId : remaining[0]!,
      }];
    }));
  }, []);

  return {
    layouts,
    findLayout,
    findLayoutByTab,
    canSplit,
    split,
    removePane,
    removeLayout,
    focusPane,
    setRatios,
    pruneSessions,
  };
}
