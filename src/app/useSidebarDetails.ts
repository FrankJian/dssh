import { useCallback, useEffect, useState } from "react";
import type { ActivityId } from "./ActivityBar";
import { readSidebarCollapsed, sidebarDetailsContext, SIDEBAR_COLLAPSED_KEY } from "./sidebarDetails";

export function useSidebarDetails(activity: ActivityId, editorActive: boolean, browserActive: boolean, filesActive = false) {
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed(localStorage));
  const context = sidebarDetailsContext(activity, editorActive, browserActive, filesActive);
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed)); }
    catch { /* Keep this window usable if preference storage is unavailable. */ }
  }, [collapsed]);
  const toggle = useCallback(() => { if (context !== null) setCollapsed(value => !value); }, [context]);
  return { collapsed, setCollapsed, toggle, context };
}
