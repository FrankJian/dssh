/** Backend-normalized paths are opaque: never lowercase remote or local paths here. */
import type { FileIdentity, LoadedText, SaveSnapshot, SavedText, TextMetadata } from "../models/editor.ts";
export type { FileSource, TextEncoding, LineEnding, TextMetadata, FileIdentity, LoadedText, SaveSnapshot, SavedText } from "../models/editor.ts";
export interface Disposable { dispose(): void }
export interface TextBuffer {
  getValue(eol?: undefined, preserveBOM?: boolean): string;
  getValueLength?(): number;
  setValue(content: string): void;
  onDidChangeContent(listener: () => void): Disposable;
  dispose(): void;
}
export interface EditorDocument<M extends TextBuffer> {
  readonly id: string;
  readonly uri: string;
  readonly model: M;
  readonly identity: FileIdentity | null;
  readonly metadata: TextMetadata;
  readonly savedContent: string;
  readonly savedMetadata: TextMetadata;
  readonly versionToken: string | null;
  readonly readOnly: boolean;
  readonly revision: number;
  readonly saving: boolean;
  readonly error: string | null;
  readonly largeFile: boolean;
}
interface Entry<M extends TextBuffer, V> {
  document: EditorDocument<M>;
  listener: Disposable;
  views: Map<string, V | null>;
  activeViews: Set<string>;
  saveTail: Promise<unknown>;
  reloading?: boolean;
}

export function fileIdentityKey(identity: FileIdentity): string {
  return JSON.stringify([identity.source.kind, identity.source.kind === "sftp" ? identity.source.profileId : null, identity.path]);
}

export function documentUri(namespace: string, id: string, path: string): string {
  const virtualPath = path.replace(/^[\\/]+/, "").split(/[\\/]/).map(encodeURIComponent).join("/");
  return `dssh-editor://${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/${virtualPath}`;
}

const bufferContent = (model: TextBuffer) => model.getValue(undefined, true);
const NORMAL_MODEL_UNITS = 20 * 1024 * 1024;
const contentVersions = new WeakMap<TextBuffer, number>();
const dirtyResults = new WeakMap<object, { version: number; dirty: boolean }>();
export function isDocumentDirty<M extends TextBuffer>(document: EditorDocument<M>): boolean {
  const version = contentVersions.get(document.model);
  const cached = dirtyResults.get(document);
  if (version !== undefined && cached?.version === version) return cached.dirty;
  const dirty = document.identity === null
    || document.metadata.encoding !== document.savedMetadata.encoding
    || document.metadata.bom !== document.savedMetadata.bom
    || document.metadata.lineEnding !== document.savedMetadata.lineEnding
    || bufferContent(document.model) !== document.savedContent;
  // Repeated tab/status renders must not rebuild a large string per consumer.
  // Versioning follows the model, so even an older document reference sees edits.
  if (version !== undefined) dirtyResults.set(document, { version, dirty });
  return dirty;
}

/** Owns buffers for a single workspace, independently of mounted editor views. */
export class DocumentRegistry<M extends TextBuffer, V = unknown> {
  private entries = new Map<string, Entry<M, V>>();
  private paths = new Map<string, string>();
  private listeners = new Set<() => void>();
  private sequence = 0;
  private snapshot = 0;
  private disposed = false;
  private saveTargets = new Map<string, string>();
  private createModel: (content: string, uri: string) => M;
  readonly namespace: string;

  constructor(namespace: string, createModel: (content: string, uri: string) => M) {
    this.namespace = namespace;
    this.createModel = createModel;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): number => this.snapshot;
  get(id: string): EditorDocument<M> | undefined { return this.entries.get(id)?.document; }
  list(): EditorDocument<M>[] { return Array.from(this.entries.values(), (entry) => entry.document); }
  find(identity: FileIdentity): EditorDocument<M> | undefined {
    const id = this.paths.get(fileIdentityKey(identity));
    return id ? this.get(id) : undefined;
  }

  open(file: LoadedText): EditorDocument<M> {
    const existing = this.find(file);
    if (existing) return existing;
    return this.create({ source: file.source, path: file.path }, file.content,
      { encoding: file.encoding, lineEnding: file.lineEnding, bom: file.bom }, file.versionToken, file.readOnly, file.largeFile ?? false);
  }

  createUntitled(content = ""): EditorDocument<M> {
    return this.create(null, content, { encoding: "utf-8", lineEnding: "lf", bom: false }, null, false);
  }

  private create(identity: FileIdentity | null, content: string, metadata: TextMetadata,
    versionToken: string | null, readOnly: boolean, largeFile = false): EditorDocument<M> {
    if (this.disposed) throw new Error("编辑工作区已关闭。");
    const id = String(++this.sequence);
    const uri = documentUri(this.namespace, id, identity?.path ?? `Untitled-${id}`);
    const model = this.createModel(content, uri);
    contentVersions.set(model, 0);
    const document: EditorDocument<M> = {
      id, uri, model, identity, metadata: { ...metadata }, savedContent: bufferContent(model),
      savedMetadata: { ...metadata }, versionToken, readOnly, largeFile, revision: 0, saving: false, error: null,
    };
    const listener = model.onDidChangeContent(() => {
      contentVersions.set(model, (contentVersions.get(model) ?? 0) + 1);
      const entry = this.entries.get(id);
      if (!entry) return;
      if (entry.reloading) return;
      entry.document = { ...entry.document, revision: entry.document.revision + 1, error: null,
        largeFile: entry.document.largeFile || (model.getValueLength?.() ?? model.getValue().length) > NORMAL_MODEL_UNITS };
      this.emit();
    });
    this.entries.set(id, { document, listener, views: new Map(), activeViews: new Set(), saveTail: Promise.resolve() });
    if (identity) this.paths.set(fileIdentityKey(identity), id);
    this.emit();
    return document;
  }

  setMetadata(id: string, metadata: Partial<TextMetadata>): void {
    const entry = this.require(id);
    entry.document = { ...entry.document, metadata: { ...entry.document.metadata, ...metadata }, revision: entry.document.revision + 1 };
    this.emit();
  }

  reload(id: string, file: LoadedText, discard = false): boolean {
    const entry = this.require(id);
    if (entry.document.saving || (!discard && isDocumentDirty(entry.document))) return false;
    if (!entry.document.identity || fileIdentityKey(entry.document.identity) !== fileIdentityKey(file)) throw new Error("重新加载的文件身份不匹配。");
    const metadata = { encoding: file.encoding, lineEnding: file.lineEnding, bom: file.bom };
    entry.reloading = true;
    try { entry.document.model.setValue(file.content); }
    finally { entry.reloading = false; }
    entry.document = { ...entry.document, metadata, savedMetadata: { ...metadata }, savedContent: bufferContent(entry.document.model),
      versionToken: file.versionToken, readOnly: file.readOnly, largeFile: file.largeFile ?? false, error: null,
      revision: entry.document.revision + 1 };
    this.emit();
    return true;
  }

  retainView(id: string, viewId: string): V | null {
    const entry = this.require(id);
    entry.activeViews.add(viewId);
    if (!entry.views.has(viewId)) entry.views.set(viewId, null);
    return entry.views.get(viewId) ?? null;
  }
  saveViewState(id: string, viewId: string, state: V | null): void {
    this.require(id).views.set(viewId, state);
  }
  releaseView(id: string, viewId: string): void { this.entries.get(id)?.activeViews.delete(viewId); }
  viewCount(id: string): number { return this.require(id).activeViews.size; }

  /** Caller must obtain save/discard authorization before closing a dirty buffer. */
  close(id: string, discard = false): boolean {
    const entry = this.require(id);
    if (entry.activeViews.size || entry.document.saving || (!discard && isDocumentDirty(entry.document))) return false;
    this.entries.delete(id);
    if (entry.document.identity) this.paths.delete(fileIdentityKey(entry.document.identity));
    entry.listener.dispose();
    entry.document.model.dispose();
    this.emit();
    return true;
  }

  /** Each queued save snapshots at execution time and uses the last successful token. */
  save(id: string, write: (snapshot: SaveSnapshot) => Promise<SavedText>,
    target?: { identity: FileIdentity; expectedVersion: string | null }): Promise<void> {
    const entry = this.require(id);
    const run = async () => {
      if (this.disposed || this.entries.get(id) !== entry) throw new Error("编辑工作区已关闭。");
      const current = entry.document;
      const identity = target?.identity ?? current.identity;
      if (!identity) throw new Error("请选择保存位置。");
      if (current.readOnly && !target) throw new Error("文件只读，请选择另存为。");
      const collision = this.find(identity);
      if (collision && collision.id !== id) throw new Error("目标文件已在此工作区打开。");
      const targetKey = fileIdentityKey(identity);
      const reservation = this.saveTargets.get(targetKey);
      if (reservation && reservation !== id) throw new Error("目标文件正在由另一个文档保存。");
      this.saveTargets.set(targetKey, id);
      const content = bufferContent(current.model);
      const metadata = { ...current.metadata };
      const snapshot: SaveSnapshot = { ...identity, ...metadata, content,
        expectedVersion: target ? target.expectedVersion : current.versionToken };
      entry.document = { ...current, saving: true, error: null };
      this.emit();
      try {
        const saved = await write(snapshot);
        if (this.disposed || this.entries.get(id) !== entry) return;
        if (fileIdentityKey(saved) !== fileIdentityKey(identity)) throw new Error("保存结果与请求的文件不匹配。");
        if (entry.document.identity) this.paths.delete(fileIdentityKey(entry.document.identity));
        this.paths.set(fileIdentityKey(identity), id);
        entry.document = { ...entry.document, identity, savedContent: content, savedMetadata: metadata,
          versionToken: saved.versionToken, saving: false, error: null, readOnly: target ? false : current.readOnly };
      } catch (error) {
        if (!this.disposed && this.entries.get(id) === entry) {
          entry.document = { ...entry.document, saving: false, error: error instanceof Error ? error.message : "保存失败。" };
        }
        throw error;
      } finally {
        if (this.saveTargets.get(targetKey) === id) this.saveTargets.delete(targetKey);
        if (!this.disposed) this.emit();
      }
    };
    const result = entry.saveTail.then(run, run);
    entry.saveTail = result.catch(() => {});
    return result;
  }

  /** Final workspace destruction, after close authorization. Safe for late callbacks. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.listener.dispose();
      entry.document.model.dispose();
    }
    this.entries.clear(); this.paths.clear(); this.saveTargets.clear(); this.listeners.clear();
  }

  private require(id: string): Entry<M, V> {
    const entry = this.entries.get(id);
    if (!entry || this.disposed) throw new Error("文档已关闭。");
    return entry;
  }
  private emit(): void {
    this.snapshot++;
    for (const listener of this.listeners) listener();
  }
}
