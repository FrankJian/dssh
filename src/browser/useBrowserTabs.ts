import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listBrowserTabs, type BrowserTab, type BrowserTabsEvent } from "../services/browserService";
import { toast } from "../ui/ToastHost";
import { browserSnapshotActivation } from "./browserTabActivation";

export function useBrowserTabs(onActivate?: (id: string) => void, restoreInitial = false) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const activate = useRef(onActivate);
  activate.current = onActivate;
  const initialSelection = useRef(restoreInitial);
  useEffect(() => {
    let disposed = false;
    let revision = -1;
    function apply(snapshot: BrowserTabsEvent) {
      if (disposed || snapshot.revision < revision) return;
      revision = snapshot.revision;
      const activeId = browserSnapshotActivation(snapshot, initialSelection.current);
      if (snapshot.tabs.length) initialSelection.current = false;
      setTabs(snapshot.tabs);
      if (activeId) activate.current?.(activeId);
    }
    const subscription = getCurrentWebview().listen<BrowserTabsEvent>("browser://tabs-changed", ({ payload }) => apply(payload));
    void subscription.then(() => listBrowserTabs()).then(apply).catch((error: Error) => {
      if (!disposed) toast(error.message, "error");
    });
    return () => { disposed = true; void subscription.then((off) => off()).catch(() => {}); };
  }, []);
  return tabs;
}
