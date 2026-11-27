import { useEffect, useRef, useState } from "react";
import type { FileIdentity } from "../models/editor";
import type { MonacoDocuments } from "./MonacoDocumentView";
import { fileIdentityKey } from "./documentRegistry";

const MAX_PREVIEWS = 8;
const MAX_UNITS = 1024 * 1024;
export interface MarkdownPreviewTab {
  id: string;
  identity: FileIdentity;
  sourceId: string;
  revision: number;
  content: string | null;
}
interface PreviewState { tabs: MarkdownPreviewTab[]; activeId: string | null; focusRequest: number }

/** Preview snapshots never retain hidden source models or enter persistent layout references. */
export function useMarkdownPreviews(registry: MonacoDocuments) {
  const [state, setState] = useState<PreviewState>({ tabs: [], activeId: null, focusRequest: 0 });
  const current = useRef(state);
  const sequence = useRef(0);
  function commit(next: PreviewState) { current.current = next; setState(next); }
  function capture(documentId: string, id: string): MarkdownPreviewTab | null {
    const document = registry.get(documentId);
    if (!document?.identity) return null;
    return { id, identity: document.identity, sourceId: document.id, revision: document.revision,
      content: document.largeFile || document.model.getValueLength() > MAX_UNITS ? null : document.model.getValue() };
  }
  useEffect(() => registry.subscribe(() => {
    let changed = false;
    const tabs = current.current.tabs.map((tab) => {
      const document = registry.get(tab.sourceId) ?? registry.find(tab.identity);
      if (!document || (document.id === tab.sourceId && document.revision === tab.revision && document.identity === tab.identity)) return tab;
      const next = capture(document.id, tab.id); if (!next) return tab;
      changed = true; return next;
    });
    if (changed) commit({ ...current.current, tabs });
  }), [registry]);
  return {
    ...state,
    count: () => current.current.tabs.length,
    has: (documentId: string) => {
      const identity = registry.get(documentId)?.identity;
      return !!identity && state.tabs.some((tab) => tab.sourceId === documentId || fileIdentityKey(tab.identity) === fileIdentityKey(identity));
    },
    open(documentId: string) {
      const document = registry.get(documentId); if (!document?.identity) return;
      const existing = current.current.tabs.find((tab) => tab.sourceId === documentId || fileIdentityKey(tab.identity) === fileIdentityKey(document.identity!));
      if (!existing && current.current.tabs.length >= MAX_PREVIEWS) throw new Error(`最多打开 ${MAX_PREVIEWS} 个 Markdown 预览，请先关闭一个预览标签。`);
      const tab = capture(documentId, existing?.id ?? `markdown-preview-${++sequence.current}`); if (!tab) return;
      commit({ tabs: existing ? current.current.tabs.map((item) => item.id === tab.id ? tab : item) : [...current.current.tabs, tab], activeId: tab.id, focusRequest: current.current.focusRequest + 1 });
    },
    select(id: string) { if (current.current.tabs.some((tab) => tab.id === id)) commit({ ...current.current, activeId: id, focusRequest: current.current.focusRequest + 1 }); },
    close(id: string) {
      const index = current.current.tabs.findIndex((tab) => tab.id === id); if (index < 0) return;
      const tabs = current.current.tabs.filter((tab) => tab.id !== id);
      commit({ tabs, activeId: current.current.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : current.current.activeId, focusRequest: current.current.focusRequest + 1 });
    },
  };
}
export type MarkdownPreviews = ReturnType<typeof useMarkdownPreviews>;
