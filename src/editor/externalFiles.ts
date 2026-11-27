import { DocumentRegistry, isDocumentDirty, type TextBuffer } from "./documentRegistry.ts";
import { EditorFileProvider } from "./fileProvider.ts";
export interface ExternalFileNotice { id: string; kind: "changed" | "missing" | "unavailable"; message: string }
/** Native events and polling are hints. Only a fresh version and an unchanged buffer allow reload. */
export class ExternalFiles<M extends TextBuffer, V = unknown> {
  private generation = 0;
  private pending = new Set<string>();
  private running: Promise<void> | null = null;
  private notices = new Map<string, ExternalFileNotice>();
  private registry: DocumentRegistry<M, V>;
  private provider: EditorFileProvider;
  private allowed: () => boolean;
  private notify: (notices: ExternalFileNotice[]) => void;
  constructor(registry: DocumentRegistry<M, V>, provider: EditorFileProvider,
    allowed: () => boolean, notify: (notices: ExternalFileNotice[]) => void) {
    this.registry = registry; this.provider = provider; this.allowed = allowed; this.notify = notify;
  }
  cancel() { this.generation++; this.pending.clear(); }
  clear(id: string) { this.notices.delete(id); this.publish(); }
  check(ids: string[]): Promise<void> {
    if (!this.allowed()) return Promise.resolve();
    for (const id of ids.slice(0, 128)) this.pending.add(id);
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  private async drain() {
    while (this.pending.size && this.allowed()) {
      const id = this.pending.values().next().value!; this.pending.delete(id);
      const document = this.registry.get(id); if (!document?.identity || document.saving) continue;
      const generation = this.generation; const revision = document.revision; const token = document.versionToken;
      const valid = () => this.allowed() && generation === this.generation && this.registry.get(id)?.identity?.path === document.identity?.path;
      try {
        const current = await this.provider.inspect(document.identity.path);
        if (!valid()) continue;
        const latest = this.registry.get(id)!;
        // A save completed while inspecting: that older result has no authority.
        if (latest.saving || latest.versionToken !== token) continue;
        if (current.versionToken === token) { this.notices.delete(id); this.publish(); continue; }
        if (current.versionToken === null) { this.notices.set(id, { id, kind: "missing", message: "文件已在外部删除；内存内容仍保留。" }); this.publish(); continue; }
        if (isDocumentDirty(latest) || latest.revision !== revision) {
          this.notices.set(id, { id, kind: "changed", message: "文件在外部发生变化；未保存内容已保留。" }); this.publish(); continue;
        }
        const file = await this.provider.read(document.identity.path, { encoding: document.metadata.encoding, allowLarge: document.largeFile });
        if (!valid()) continue;
        const unchanged = this.registry.get(id)!;
        if (unchanged.revision !== revision || unchanged.versionToken !== token || unchanged.saving || isDocumentDirty(unchanged)) continue;
        if (this.registry.reload(id, file)) { this.notices.delete(id); this.publish(); }
      } catch (error) {
        if (valid()) { this.notices.set(id, { id, kind: "unavailable", message: error instanceof Error ? error.message : "无法检查文件版本。" }); this.publish(); }
      }
    }
  }
  private publish() { for (const id of this.notices.keys()) if (!this.registry.get(id)) this.notices.delete(id); this.notify([...this.notices.values()]); }
}
