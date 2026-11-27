import type { EditorScanBatch, EditorScanProgress, EditorScanRequest, FileSource, LoadedText } from "../models/editor.ts";
import { DocumentRegistry, fileIdentityKey, type TextBuffer } from "./documentRegistry.ts";
import type { TextSearchQuery, TextSearchResult } from "./searchMatch.ts";
export interface ScanApi {
  start(request: EditorScanRequest): Promise<string>;
  next(workspaceId: string, operationId: string): Promise<EditorScanBatch>;
  cancel(workspaceId: string, operationId: string): Promise<void>;
  filter(request: EditorScanRequest): Promise<string[]>;
}
export interface SearchFileResult { path: string; original: string; result: TextSearchResult; documentId?: string; revision?: number; file?: LoadedText }
export interface WorkspaceSearchState { files: SearchFileResult[]; count: number; progress: EditorScanProgress | null; complete: boolean; reason: string | null; failures: Array<{ path: string; message: string }> }
export const DEFAULT_EDITOR_EXCLUDES = ["**/.git", "**/node_modules", "**/target", "**/dist"];
export async function runWorkspaceSearch<M extends TextBuffer, V>(options: {
  registry: DocumentRegistry<M, V>; request: EditorScanRequest; query: TextSearchQuery; api: ScanApi;
  source: FileSource;
  match(content: string, query: TextSearchQuery, limit: number, signal: AbortSignal): Promise<TextSearchResult>;
  signal: AbortSignal; allowed(): boolean; update(state: WorkspaceSearchState): void;
}): Promise<WorkspaceSearchState> {
  const { registry, request, query, api, signal } = options;
  const state: WorkspaceSearchState = { files: [], count: 0, progress: null, complete: false, reason: null, failures: [] };
  const seen = new Set<string>(); let operation: string | null = null; let retained = 0;
  const cancelled = () => signal.aborted || !options.allowed();
  const publish = () => { if (!cancelled()) options.update({ ...state, files: [...state.files], failures: [...state.failures] }); };
  async function process(path: string, file?: LoadedText) {
    if (seen.has(path) || cancelled()) return;
    if (file && fileIdentityKey(file) !== fileIdentityKey({ source: options.source, path })) throw new Error("搜索文件不属于当前来源或路径。");
    const document = registry.find({ source: options.source, path });
    const current = document && !document.largeFile ? document : undefined;
    if (document?.largeFile) { if (state.failures.length < 200) state.failures.push({ path, message: "大文件受限模式不参加目录内容搜索。" }); return; }
    if (!current && !file) return;
    seen.add(path);
    const original = current ? current.model.getValue() : file!.content;
    const charge = original.length * 2;
    if (retained + charge > 256 * 1024 * 1024) { state.reason = "memory"; return; }
    retained += charge;
    try {
      const result = await options.match(original, query, 2000 - state.count, signal);
      if (cancelled()) return;
      if (result.matches.length) state.files.push({ path, original, result, ...(current ? { documentId: current.id, revision: current.revision } : { file }) });
      state.count += result.matches.length;
      if (result.truncated || state.count >= 2000) state.reason = "matches";
    } catch (error) {
      if (!cancelled() && state.failures.length < 200) state.failures.push({ path, message: error instanceof Error ? error.message : "匹配失败。" });
    }
  }
  try {
    const open = registry.list().filter((d) => d.identity).map((d) => d.identity!.path);
    const eligible = await api.filter({ ...request, skipPaths: open });
    if (cancelled()) return state;
    for (const path of eligible) { await process(path); if (cancelled() || state.reason) break; publish(); }
    if (!cancelled() && !state.reason) {
      operation = await api.start({ ...request, content: true, skipPaths: [...seen] });
      if (cancelled()) return state;
      while (!cancelled() && !state.reason) {
        const batch = await api.next(request.workspaceId, operation);
        if (cancelled()) break;
        if (batch.operationId !== operation) throw new Error("搜索响应不属于当前操作。");
        state.progress = batch.progress;
        for (const item of batch.items) { if (item.file) await process(item.path, item.file); if (state.reason || cancelled()) break; }
        if (batch.progress.done) { operation = null; state.complete = true; state.reason ??= batch.progress.reason; break; }
        publish();
      }
    }
    if (state.reason) state.complete = true;
    if (cancelled()) state.reason = "cancelled";
    publish(); return state;
  } finally {
    if (operation) await api.cancel(request.workspaceId, operation).catch(() => {});
  }
}
