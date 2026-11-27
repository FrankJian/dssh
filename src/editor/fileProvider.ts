import type { EditorWorkspace, LoadedText, SaveSnapshot, TextEncoding } from "../models/editor.ts";
import { closeEditorWorkspace, listEditorFiles, readEditorText, saveEditorText, inspectEditorFile, readEditorImage, EditorFileError } from "../services/editorService.ts";
import { fileIdentityKey } from "./documentRegistry.ts";

const services = { close: closeEditorWorkspace, list: listEditorFiles, read: readEditorText, save: saveEditorText, inspect: inspectEditorFile };

/** A provider is bound to an opaque Rust workspace, never to arbitrary caller-supplied profiles. */
export class EditorFileProvider {
  readonly workspace: EditorWorkspace;
  private io: typeof services & { image?: typeof readEditorImage };
  private closed = false;
  constructor(workspace: EditorWorkspace, io: typeof services & { image?: typeof readEditorImage } = services) { this.workspace = workspace; this.io = io; }

  async list(path: string) { this.ensureOpen(); const listing = await this.io.list(this.workspace.id, path); this.ensureOpen(); return listing; }
  async image(path: string) { this.ensureOpen(); const image = await (this.io.image ?? readEditorImage)(this.workspace.id, path); this.ensureOpen(); return image; }
  async inspect(path: string) {
    this.ensureOpen();
    const result = await this.io.inspect(this.workspace.id, path);
    this.ensureOpen(); this.ensureSource(result.source); return result;
  }
  async read(path: string, options: { encoding?: TextEncoding; allowLarge?: boolean } = {}): Promise<LoadedText> {
    this.ensureOpen();
    const file = await this.io.read({ workspaceId: this.workspace.id, path, ...options });
    this.ensureOpen(); this.ensureSource(file.source);
    return file;
  }
  async save(snapshot: SaveSnapshot, options: { allowNonAtomic?: boolean } = {}) {
    this.ensureOpen(); this.ensureSource(snapshot.source);
    const { source: _, ...request } = snapshot;
    const result = await this.io.save({ ...request, workspaceId: this.workspace.id, ...options });
    this.ensureOpen(); this.ensureSource(result.source);
    return result;
  }
  async close() {
    if (this.closed) return;
    await this.io.close(this.workspace.id);
    this.closed = true;
  }
  private ensureSource(source: EditorWorkspace["source"]) {
    if (fileIdentityKey({ source, path: "" }) !== fileIdentityKey({ source: this.workspace.source, path: "" })) {
      throw new EditorFileError("editor_source_mismatch", "文件来源不属于此编辑工作区。");
    }
  }
  private ensureOpen() {
    if (this.closed) throw new EditorFileError("editor_workspace_unavailable", "编辑工作区已关闭。");
  }
}
