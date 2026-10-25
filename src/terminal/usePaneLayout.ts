import { useCallback, useRef, useState } from "react";

export type SplitDir = "h" | "v";

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

function removeLeaf(node: PaneNode, sessionId: string): PaneNode | null {
  if (node.type === "leaf") return node.sessionId === sessionId ? null : node;
  const first = removeLeaf(node.children[0], sessionId);
  const second = removeLeaf(node.children[1], sessionId);
  if (!first) return second;
  if (!second) return first;
  if (first === node.children[0] && second === node.children[1]) return node;
  const children: [PaneNode, PaneNode] = [first, second];
  const changedSpan = axisSpan(first, node.dir) !== axisSpan(node.children[0], node.dir)
    || axisSpan(second, node.dir) !== axisSpan(node.children[1], node.dir);
  return { ...node, children, ratios: changedSpan ? axisRatios(children, node.dir) : node.ratios };
}

function axisSpan(node: PaneNode, dir: SplitDir): number {
  return node.type === "split" && node.dir === dir
    ? axisSpan(node.children[0], dir) + axisSpan(node.children[1], dir)
    : 1;
}

function axisRatios(children: [PaneNode, PaneNode], dir: SplitDir): [number, number] {
  const first = axisSpan(children[0], dir);
  const second = axisSpan(children[1], dir);
  return [first / (first + second), second / (first + second)];
}

/** Divide each axis equally without counting splits on the other axis. */
export function balancePaneTree(node: PaneNode): PaneNode {
  if (node.type === "leaf") return node;
  const first = balancePaneTree(node.children[0]);
  const second = balancePaneTree(node.children[1]);
  const children: [PaneNode, PaneNode] = [first, second];
  return {
    ...node,
    children,
    ratios: axisRatios(children, node.dir),
  };
}

/** A new split only changes ratios along its own axis on the path to that pane. */
export function splitPaneTree(node: PaneNode, sessionId: string, replacement: PaneSplit): PaneNode {
  if (node.type === "leaf") return node.sessionId === sessionId ? replacement : node;
  const children: [PaneNode, PaneNode] = [
    splitPaneTree(node.children[0], sessionId, replacement),
    splitPaneTree(node.children[1], sessionId, replacement),
  ];
  if (children[0] === node.children[0] && children[1] === node.children[1]) return node;
  return {
    ...node,
    children,
    ratios: node.dir === replacement.dir ? axisRatios(children, node.dir) : node.ratios,
  };
}

export function prunePaneLayouts(layouts: PaneLayout[], removedSessionIds: ReadonlySet<string>): PaneLayout[] {
  if (removedSessionIds.size === 0) return layouts;
  let changedAny = false;
  const next = layouts.flatMap((layout) => {
    let root: PaneNode | null = layout.root;
    let changed = false;
    for (const sessionId of paneSessionIds(layout)) {
      if (removedSessionIds.has(sessionId) && root) {
        root = removeLeaf(root, sessionId);
        changed = true;
      }
    }
    if (!changed) return [layout];
    changedAny = true;
    if (root?.type !== "split") return [];
    const remaining = paneSessionIds(root);
    return [{
      ...layout,
      root,
      tabSessionId: remaining.includes(layout.tabSessionId) ? layout.tabSessionId : remaining[0]!,
      focusedPaneId: remaining.includes(layout.focusedPaneId) ? layout.focusedPaneId : remaining[0]!,
    }];
  });
  return changedAny ? next : layouts;
}

function setSplitRatios(node: PaneNode, splitId: string, ratios: [number, number]): PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, ratios };
  const first = setSplitRatios(node.children[0], splitId, ratios);
  const second = setSplitRatios(node.children[1], splitId, ratios);
  // Keep the node identity when the split is not in this branch, so dragging a
  // divider does not force every other pane to re-render.
  if (first === node.children[0] && second === node.children[1]) return node;
  return { ...node, children: [first, second] };
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

  const canSplit = useCallback((sessionId: string | null) => Boolean(sessionId), []);

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
      if (paneSessionIds(layout).includes(newSessionId)) {
        return current;
      }
      const next = [...current];
      next[index] = {
        ...layout,
        focusedPaneId: newSessionId,
        root: splitPaneTree(layout.root, currentId, makeSplit({ type: "leaf", sessionId: currentId })) as PaneSplit,
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

  /** Replace one terminal window's tree after it returns from a detached window. */
  const replaceLayout = useCallback((layout: PaneLayout | null) => {
    if (!layout) return;
    setLayouts((current) => {
      const incomingSessionIds = new Set(paneSessionIds(layout));
      const index = current.findIndex((item) =>
        item.tabSessionId === layout.tabSessionId || paneSessionIds(item).some((id) => incomingSessionIds.has(id)),
      );
      if (index < 0) return [...current, layout];
      const next = [...current];
      next[index] = layout;
      return next;
    });
  }, []);

  const focusPane = useCallback((sessionId: string) => {
    setLayouts((current) => current.map((layout) =>
      paneSessionIds(layout).includes(sessionId) ? { ...layout, focusedPaneId: sessionId } : layout,
    ));
  }, []);

  const setRatios = useCallback((splitId: string, ratios: [number, number]) => {
    setLayouts((current) => {
      let changed = false;
      const next = current.map((layout) => {
        const root = setSplitRatios(layout.root, splitId, ratios) as PaneSplit;
        if (root === layout.root) return layout;
        changed = true;
        return { ...layout, root };
      });
      // Only the dragged window's tree is rebuilt; the rest keep their identity.
      return changed ? next : current;
    });
  }, []);

  /** Remove only sessions known to have closed, never a pane being created. */
  const pruneSessions = useCallback((removedSessionIds: Set<string>) => {
    setLayouts((current) => prunePaneLayouts(current, removedSessionIds));
  }, []);

  return {
    layouts,
    findLayout,
    findLayoutByTab,
    canSplit,
    split,
    removePane,
    removeLayout,
    replaceLayout,
    focusPane,
    setRatios,
    pruneSessions,
  };
}
