import { useCallback, useState } from "react";

/**
 * A non-terminal surface that lives in the top tab strip. Phase 1 supports SFTP
 * tabs (one per host node); later phases add forwards / host-monitor kinds here.
 */
export interface SftpTab {
  /** Stable id: `sftp:${profileId}` — one SFTP tab per host. */
  id: string;
  profileId: string;
  title: string;
}

/**
 * Coordinates which surface the main column shows. Terminal sessions remain the
 * source of truth in useTerminalSessions; this hook layers non-terminal tabs
 * (SFTP for now) and a single "active surface" selector on top: when
 * `activeSftpId` is set the SFTP tab is shown, otherwise the active terminal is.
 */
export function useWorkspace() {
  const [sftpTabs, setSftpTabs] = useState<SftpTab[]>([]);
  const [activeSftpId, setActiveSftpId] = useState<string | null>(null);
  // User-defined tab order (ids). Tabs missing from this list keep their natural
  // order and sort after the explicitly-ordered ones.
  const [tabOrder, setTabOrder] = useState<string[]>([]);

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

  const openSftpTab = useCallback((profileId: string, title: string) => {
    const id = `sftp:${profileId}`;
    setSftpTabs((current) =>
      current.some((tab) => tab.id === id) ? current : [...current, { id, profileId, title }],
    );
    setActiveSftpId(id);
    return id;
  }, []);

  const closeSftpTab = useCallback((id: string) => {
    setSftpTabs((current) => current.filter((tab) => tab.id !== id));
    setActiveSftpId((current) => (current === id ? null : current));
  }, []);

  /** Close every SFTP tab bound to a host (used when a node disconnects). */
  const closeSftpTabsForProfile = useCallback((profileId: string) => {
    const id = `sftp:${profileId}`;
    setSftpTabs((current) => current.filter((tab) => tab.id !== id));
    setActiveSftpId((current) => (current === id ? null : current));
  }, []);

  const focusSftpTab = useCallback((id: string) => {
    setActiveSftpId(id);
  }, []);

  /** Switch the main column back to the active terminal surface. */
  const focusTerminal = useCallback(() => {
    setActiveSftpId(null);
  }, []);

  return {
    sftpTabs,
    activeSftpId,
    tabOrder,
    reorderTab,
    openSftpTab,
    closeSftpTab,
    closeSftpTabsForProfile,
    focusSftpTab,
    focusTerminal,
  };
}
