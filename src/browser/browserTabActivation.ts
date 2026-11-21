interface BrowserSelectionSnapshot {
  activeId: string | null;
  tabs: readonly { id: string }[];
}

/** A newly detached, otherwise empty workbench may miss the one-shot move event. */
export function browserSnapshotActivation(snapshot: BrowserSelectionSnapshot, restoreInitial: boolean): string | null {
  if (snapshot.activeId && snapshot.tabs.some((tab) => tab.id === snapshot.activeId)) return snapshot.activeId;
  return restoreInitial ? snapshot.tabs[0]?.id ?? null : null;
}
