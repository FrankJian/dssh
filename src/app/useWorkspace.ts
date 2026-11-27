import { useCallback, useRef, useState } from "react";
import type { JumpServerSftpTarget } from "../terminal/terminalTarget";
import type { EditorLayoutReference } from "../editor/layoutReferences";
import type { EditorWorkspace } from "../models/editor";

export interface EditorTab { id: string; title: string; workspace: EditorWorkspace; restore?: EditorLayoutReference }

/**
 * A non-terminal surface that lives in the top tab strip. Phase 1 supports SFTP
 * tabs (one per host node); later phases add forwards / host-monitor kinds here.
 */
export interface SftpTab {
  /** The first tab uses `sftp:${profileId}`; duplicates have unique ids. */
  id: string;
  profileId: string;
  title: string;
  asset?: JumpServerSftpTarget;
  /** Last successfully opened directories, retained while the tab is open. */
  remotePath?: string;
  localPath?: string;
}

export type SftpTabPaths = Pick<SftpTab, "remotePath" | "localPath">;

/**
 * Coordinates which surface the main column shows. Terminal sessions remain the
 * source of truth in useTerminalSessions; this hook layers non-terminal tabs
 * (SFTP for now) and a single "active surface" selector on top: when
 * `activeSftpId` is set the SFTP tab is shown, otherwise the active terminal is.
 */
export function useWorkspace(initialTabs: SftpTab[] = [], initialOrder: string[] = []) {
  const [sftpTabs, setSftpTabs] = useState<SftpTab[]>(initialTabs);
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const editorTabsStore = useRef<EditorTab[]>([]);
  const updateEditorTabs = useCallback((update: (tabs: EditorTab[]) => EditorTab[]) => {
    editorTabsStore.current = update(editorTabsStore.current); setEditorTabs(editorTabsStore.current);
  }, []);
  const getEditorTabs = useCallback(() => editorTabsStore.current, []);
  const editorHistory = useRef<string[]>([]);
  const editorEntryPending = useRef<Promise<string | undefined> | null>(null);
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [activeBrowserId, setActiveBrowserId] = useState<string | null>(null);
  const [activeSftpId, setActiveSftpId] = useState<string | null>(initialTabs[0]?.id ?? null);
  // User-defined tab order (ids). Tabs missing from this list keep their natural
  // order and sort after the explicitly-ordered ones.
  const [tabOrder, setTabOrder] = useState<string[]>(initialOrder);

  /** Move `draggedId` to sit where `targetId` currently is. */
  const reorderTab = useCallback((draggedId: string, targetId: string, allIds: string[]) => {
    if (draggedId === targetId) {
      return;
    }
    setTabOrder(() => {
      // Start from the currently displayed order so the drop lands where the
      // user sees it, not where a stale saved order would put it.
      const next = allIds.filter((id) => id !== draggedId);
      const index = next.indexOf(targetId);
      if (index < 0) {
        return allIds;
      }
      next.splice(index, 0, draggedId);
      return next;
    });
  }, []);

  const openSftpTab = useCallback((profileId: string, title: string, asset?: JumpServerSftpTarget) => {
    const id = asset ? `sftp:${profileId}:asset:${asset.account}@${asset.address}` : `sftp:${profileId}`;
    setSftpTabs((current) =>
      current.some((tab) => tab.id === id) ? current : [...current, { id, profileId, title, asset }],
    );
    setActiveBrowserId(null);
    setActiveEditorId(null);
    setActiveSftpId(id);
    return id;
  }, []);

  const duplicateSftpTab = useCallback((source: SftpTab) => {
    const id = `sftp:${source.profileId}:${crypto.randomUUID()}`;
    setSftpTabs((current) => [...current, { ...source, id }]);
    setActiveBrowserId(null);
    setActiveEditorId(null);
    setActiveSftpId(id);
    return id;
  }, []);

  const closeSftpTab = useCallback((id: string) => {
    setSftpTabs((current) => current.filter((tab) => tab.id !== id));
    setActiveSftpId((current) => (current === id ? null : current));
  }, []);

  /** Close every SFTP tab bound to a host (used when a node disconnects). */
  const closeSftpTabsForProfile = useCallback((profileId: string) => {
    setSftpTabs((current) => current.filter((tab) => tab.profileId !== profileId));
    setActiveSftpId((current) => current === `sftp:${profileId}` || current?.startsWith(`sftp:${profileId}:`) ? null : current);
  }, []);

  const updateSftpTabPaths = useCallback((id: string, paths: Partial<SftpTabPaths>) => {
    setSftpTabs((current) => {
      const tab = current.find((item) => item.id === id);
      if (!tab) return current;
      const remotePath = paths.remotePath ?? tab.remotePath;
      const localPath = paths.localPath ?? tab.localPath;
      if (remotePath === tab.remotePath && localPath === tab.localPath) return current;
      return current.map((item) => item.id === id ? { ...item, remotePath, localPath } : item);
    });
  }, []);

  const renameSftpTab = useCallback((id: string, title: string) => {
    setSftpTabs((current) => current.map((tab) => tab.id === id ? { ...tab, title } : tab));
  }, []);

  const focusSftpTab = useCallback((id: string) => {
    setActiveBrowserId(null);
    setActiveEditorId(null);
    setActiveSftpId(id);
  }, []);

  /** Switch the main column back to the active terminal surface. */
  const focusTerminal = useCallback(() => {
    setActiveBrowserId(null);
    setActiveEditorId(null);
    setActiveSftpId(null);
  }, []);

  const focusBrowserTab = useCallback((id: string) => { setActiveEditorId(null); setActiveSftpId(null); setActiveBrowserId(id); }, []);
  const focusEditorTab = useCallback((id: string) => {
    editorHistory.current = [id, ...editorHistory.current.filter((previous) => previous !== id)];
    setActiveBrowserId(null); setActiveSftpId(null); setActiveEditorId(id);
  }, []);
  const openEditorEntry = useCallback(async (create: () => Promise<string | undefined>) => {
    const existing = editorHistory.current.find((id) => editorTabs.some((tab) => tab.id === id)) ?? editorTabs[editorTabs.length - 1]?.id;
    if (existing) { focusEditorTab(existing); return existing; }
    if (editorEntryPending.current) return editorEntryPending.current;
    const pending = create(); editorEntryPending.current = pending;
    try { return await pending; }
    finally { if (editorEntryPending.current === pending) editorEntryPending.current = null; }
  }, [editorTabs, focusEditorTab]);
  const addEditorTab = useCallback((workspace: EditorWorkspace, title: string, restore?: EditorLayoutReference) => {
    const id = `editor:${workspace.id}`;
    updateEditorTabs((current) => [...current, { id, title, workspace, restore }]);
    focusEditorTab(id); return id;
  }, [focusEditorTab, updateEditorTabs]);
  const closeEditorTab = useCallback((id: string) => {
    editorHistory.current = editorHistory.current.filter((previous) => previous !== id);
    updateEditorTabs((current) => current.filter((item) => item.id !== id));
    setActiveEditorId((current) => current === id ? null : current);
  }, [updateEditorTabs]);
  const renameEditorTab = useCallback((id: string, title: string) => updateEditorTabs((current) => current.map((item) => item.id === id ? { ...item, title } : item)), [updateEditorTabs]);
  const replaceEditorTab = useCallback((id: string, expectedWorkspaceId: string, workspace: EditorWorkspace, title: string, restore?: EditorLayoutReference) => {
    if (!editorTabsStore.current.some((tab) => tab.id === id && tab.workspace.id === expectedWorkspaceId)) return false;
    updateEditorTabs((tabs) => tabs.map((tab) => tab.id === id ? { ...tab, workspace, title, restore } : tab));
    return true;
  }, [updateEditorTabs]);

  return {
    editorTabs, getEditorTabs, replaceEditorTab, activeEditorId, focusEditorTab, openEditorEntry, addEditorTab, closeEditorTab, renameEditorTab,
    activeBrowserId,
    focusBrowserTab,
    sftpTabs,
    activeSftpId,
    tabOrder,
    reorderTab,
    openSftpTab,
    duplicateSftpTab,
    closeSftpTab,
    closeSftpTabsForProfile,
    updateSftpTabPaths,
    renameSftpTab,
    focusSftpTab,
    focusTerminal,
  };
}
