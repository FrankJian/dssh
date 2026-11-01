/** History is ordered from least to most recently active, independently of tab order. */
export function reconcileWorkspaceTabFocus(
  history: readonly string[],
  activeId: string | null,
  openIds: readonly string[],
): { history: string[]; activeId: string | null } {
  const open = new Set(openIds);
  const remaining = history.filter((id) => open.has(id));
  const next = activeId === null ? null
    : open.has(activeId) ? activeId
    : remaining[remaining.length - 1] ?? openIds[0] ?? null;
  return {
    history: next === null ? remaining : [...remaining.filter((id) => id !== next), next],
    activeId: next,
  };
}
