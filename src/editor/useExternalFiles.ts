import { useEffect, useMemo, useRef, useState } from "react";
import type { MonacoDocuments } from "./MonacoDocumentView";
import { EditorFileProvider } from "./fileProvider";
import { ExternalFiles, type ExternalFileNotice } from "./externalFiles";
import { onEditorFilesChanged, watchEditorFiles } from "../services/editorService";

export function useExternalFiles(registry: MonacoDocuments, provider: EditorFileProvider, activeIds: string[], enabled: boolean, nativeEvents: boolean) {
  const [notices, setNotices] = useState<ExternalFileNotice[]>([]);
  const allowed = useRef(enabled); allowed.current = enabled;
  const ids = useRef(activeIds); ids.current = activeIds;
  const monitor = useMemo(() => new ExternalFiles(registry, provider, () => allowed.current, setNotices), [registry, provider]);
  const watchId = useRef<string | null>(null);
  const watchTail = useRef<Promise<unknown>>(Promise.resolve());
  const paths = JSON.stringify(registry.list().filter((d) => d.identity && !d.largeFile).slice(0, 128).map((d) => d.identity!.path));
  const activeKey = activeIds.join(",");
  useEffect(() => () => monitor.cancel(), [monitor]);
  useEffect(() => {
    if (!enabled) { monitor.cancel(); return; }
    const check = () => { void monitor.check(ids.current.slice(0, 8)); };
    check(); window.addEventListener("focus", check);
    const interval = window.setInterval(check, provider.workspace.source.kind === "local" ? 15_000 : 30_000);
    return () => { window.removeEventListener("focus", check); window.clearInterval(interval); monitor.cancel(); };
  }, [monitor, enabled, activeKey, provider]);
  useEffect(() => {
    if (!nativeEvents || provider.workspace.source.kind !== "local") return;
    let alive = true;
    const subscription = onEditorFilesChanged((event) => {
      if (alive && event.workspaceId === provider.workspace.id && event.watchId === watchId.current && allowed.current) {
        void monitor.check(registry.list().filter((d) => !d.largeFile).map((d) => d.id));
      }
    });
    return () => { alive = false; void subscription.then((unlisten) => unlisten()).catch(() => {}); };
  }, [monitor, nativeEvents, provider, registry]);
  useEffect(() => {
    if (!nativeEvents || provider.workspace.source.kind !== "local") return;
    let alive = true;
    // Serialize replacement/unsubscribe so StrictMode or fast tab changes cannot remove a newer watch.
    watchTail.current = watchTail.current.catch(() => {}).then(async () => {
      const next = await watchEditorFiles(provider.workspace.id, enabled ? JSON.parse(paths) : []);
      if (alive) watchId.current = next;
    }).catch(() => { /* Focus and periodic checks remain active when OS notifications are unavailable. */ });
    return () => {
      alive = false; watchId.current = null;
      watchTail.current = watchTail.current.catch(() => {}).then(() => watchEditorFiles(provider.workspace.id, [])).catch(() => {});
    };
  }, [provider, nativeEvents, paths, enabled]);
  return { notices, clear: (id: string) => monitor.clear(id), check: () => monitor.check(ids.current.slice(0, 8)) };
}
