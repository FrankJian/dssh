import type { FileSource } from "../models/editor.ts";
import { DocumentRegistry, type TextBuffer } from "./documentRegistry.ts";
import { EditorFileProvider } from "./fileProvider.ts";
import type { SearchFileResult } from "./searchRunner.ts";
export interface ReplaceOutcome { path: string; status: "memory" | "saved" | "conflict" | "failed" | "unprocessed"; message?: string }
/** Called only after the reviewed plan was explicitly confirmed. No retry can broaden its versions. */
export async function applyReplacePlan<M extends TextBuffer, V>(options: {
  plan: SearchFileResult[]; source: FileSource; registry: DocumentRegistry<M, V>; provider: EditorFileProvider;
  allowed(): boolean; signal: AbortSignal; apply(documentId: string, result: SearchFileResult): void;
  update(outcomes: ReplaceOutcome[]): void;
}): Promise<ReplaceOutcome[]> {
  const outcomes: ReplaceOutcome[] = [];
  for (const item of options.plan) {
    if (options.signal.aborted || !options.allowed()) { outcomes.push({ path: item.path, status: "unprocessed" }); continue; }
    try {
      if (item.result.content === undefined || item.result.truncated) throw new Error("替换预览不完整，请重新搜索。");
      const current = options.registry.find({ source: options.source, path: item.path });
      if (item.documentId) {
        if (!current || current.id !== item.documentId || current.revision !== item.revision || current.model.getValue() !== item.original || current.readOnly || current.saving) {
          outcomes.push({ path: item.path, status: "conflict", message: "文档在预览后改变、关闭或变为只读。" });
        } else {
          options.apply(current.id, item); outcomes.push({ path: item.path, status: "memory" });
        }
      } else if (current) {
        // Opening a file after the preview changes where its edits would be applied.
        outcomes.push({ path: item.path, status: "conflict", message: "文件在预览后被打开，请重新预览内存版本。" });
      } else {
        if (!item.file || item.file.readOnly) throw new Error("文件只读或缺少版本信息。");
        const inspected = await options.provider.inspect(item.path);
        if (options.signal.aborted || !options.allowed()) { outcomes.push({ path: item.path, status: "unprocessed" }); continue; }
        if (inspected.versionToken !== item.file.versionToken || inspected.readOnly || options.registry.find({ source: options.source, path: item.path })) {
          outcomes.push({ path: item.path, status: "conflict", message: "文件在预览后发生变化。" });
        } else {
          await options.provider.save({ source: options.source, path: item.path, encoding: item.file.encoding, bom: item.file.bom,
            lineEnding: item.file.lineEnding, expectedVersion: item.file.versionToken, content: item.result.content });
          outcomes.push({ path: item.path, status: "saved" });
        }
      }
    } catch (error) {
      const conflict = error && typeof error === "object" && "code" in error && error.code === "editor_conflict";
      outcomes.push({ path: item.path, status: conflict ? "conflict" : "failed", message: error instanceof Error ? error.message : "替换失败。" });
    }
    options.update([...outcomes]);
  }
  options.update([...outcomes]); return outcomes;
}
