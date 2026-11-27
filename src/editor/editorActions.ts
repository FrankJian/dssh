import type { EditorFileVersion, LoadedText, TextEncoding } from "../models/editor.ts";
import { DocumentRegistry, isDocumentDirty, type EditorDocument, type TextBuffer } from "./documentRegistry.ts";
import { EditorFileProvider } from "./fileProvider.ts";

export interface EditorChoice { id: string; label: string; danger?: boolean }
export interface EditorQuestion { kind?: "saveChanges"; title: string; message: string; choices: EditorChoice[] }
export interface EditorInteraction {
  choose(question: EditorQuestion): Promise<string | null>;
  choosePath(suggested: string): Promise<string | null>;
  compare(documentId: string, original: string, modified: string): void;
  allowed(): boolean;
}
export interface ClosePlan { documents: Array<{ id: string; revision: number; discard: boolean }> }
const encodings: TextEncoding[] = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gb18030"];
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "";

/** All entry points share these decisions; no menu or shortcut can bypass them. */
export class EditorActions<M extends TextBuffer, V = unknown> {
  readonly registry: DocumentRegistry<M, V>;
  readonly provider: EditorFileProvider;
  private interaction: EditorInteraction;
  constructor(registry: DocumentRegistry<M, V>, provider: EditorFileProvider, interaction: EditorInteraction) {
    this.registry = registry; this.provider = provider; this.interaction = interaction;
  }

  newFile(content = "") { this.guard(); return this.registry.createUntitled(content); }
  async open(path: string) {
    this.guard();
    const existing = this.registry.find({ source: this.provider.workspace.source, path });
    if (existing) return existing;
    const file = await this.read(path);
    this.guard(); return file ? this.registry.open(file) : null;
  }

  async readForComparison(path: string, encoding?: TextEncoding) { this.guard(); const file = await this.read(path, encoding, false); this.guard(); if (file?.largeFile) throw new Error("大文件受限模式不支持差异比较。"); return file; }

  private async read(path: string, encoding?: TextEncoding, allowLimited = true): Promise<LoadedText | null> {
    let allowLarge = false;
    for (;;) {
      this.guard();
      try { return await this.provider.read(path, { encoding, allowLarge }); }
      catch (error) {
        if (code(error) === "editor_large_file") {
          if (!allowLimited) throw new Error("大文件受限模式不支持差异比较。");
          if (await this.ask({ title: "打开大文件", message: `${path}\n文件超过 20 MiB，受限模式会关闭高成本语言分析和预览。`, choices: [{ id: "limited", label: "以受限模式打开" }] }) !== "limited") return null;
          allowLarge = true;
        } else if (code(error) === "editor_encoding") {
          const choice = await this.ask({ title: "选择文件编码", message: `${path}\n无法按当前编码无损读取。`, choices: encodings.map((id) => ({ id, label: id.toUpperCase() })) });
          if (!choice || !encodings.includes(choice as TextEncoding)) return null;
          encoding = choice as TextEncoding;
        } else throw error;
      }
    }
  }

  async save(id: string, as = false): Promise<boolean> {
    this.guard();
    let document = this.require(id);
    if (!as && document.identity && !isDocumentDirty(document)) return true;
    if (document.metadata.lineEnding === "mixed") {
      const choice = await this.ask({ title: "选择行尾", message: "此文件包含混合行尾，请确认保存时使用的格式。", choices: [{ id: "lf", label: "LF" }, { id: "crlf", label: "CRLF" }] });
      if (choice !== "lf" && choice !== "crlf") return false;
      this.registry.setMetadata(id, { lineEnding: choice }); document = this.require(id);
    }
    let target: EditorFileVersion | undefined;
    if (as || !document.identity || document.readOnly) {
      const path = await this.interaction.choosePath(document.identity?.path ?? "Untitled.txt");
      this.guard(); if (!path) return false;
      target = await this.provider.inspect(path);
      if (target.readOnly) throw new Error("目标文件只读，请选择其他保存位置。");
      if (target.versionToken && await this.ask({ title: "覆盖已有文件", message: target.path, choices: [{ id: "overwrite", label: "覆盖", danger: true }] }) !== "overwrite") return false;
    }
    let allowNonAtomic = false;
    for (;;) {
      this.guard();
      try {
        await this.registry.save(id, (snapshot) => { this.guard(); return this.provider.save(snapshot, { allowNonAtomic }); },
          target ? { identity: { source: target.source, path: target.path }, expectedVersion: target.versionToken } : undefined);
        return true;
      } catch (error) {
        if (code(error) === "editor_atomic_unavailable" && !allowNonAtomic) {
          const choice = await this.ask({ title: "非原子覆盖", message: "服务器无法安全替换此文件。继续会直接覆盖原文件，断网或写入失败可能造成部分内容丢失。", choices: [{ id: "saveAs", label: "另存为" }, { id: "continue", label: "本次仍覆盖", danger: true }] });
          if (choice === "saveAs") return this.save(id, true);
          if (choice !== "continue") return false;
          allowNonAtomic = true;
        } else if (code(error) === "editor_conflict") {
          const path = target?.path ?? this.require(id).identity?.path;
          if (!path) throw error;
          const current = await this.provider.inspect(path);
          const choice = await this.ask({ title: "文件在外部发生变化", message: path, choices: [
            ...(current.versionToken && !this.require(id).largeFile ? [{ id: "compare", label: "比较" }] : []),
            { id: "saveAs", label: "另存为" },
            { id: "overwrite", label: current.versionToken ? "覆盖当前版本" : "重新创建", danger: true },
          ] });
          if (choice === "saveAs") return this.save(id, true);
          if (choice === "compare") {
            const external = await this.readForComparison(path, this.require(id).metadata.encoding);
            if (external) this.interaction.compare(id, external.content, this.require(id).model.getValue());
            return false;
          }
          if (choice !== "overwrite") return false;
          target = current;
          // A confirmed overwrite remains bound to this version; the backend rechecks it.
        } else throw error;
      }
    }
  }

  async saveAll() {
    const results: Array<{ id: string; saved: boolean; error?: string }> = [];
    for (const document of this.registry.list()) {
      if (!isDocumentDirty(document)) continue;
      try { results.push({ id: document.id, saved: await this.save(document.id) }); }
      catch (error) { results.push({ id: document.id, saved: false, error: error instanceof Error ? error.message : "保存失败。" }); }
    }
    return results;
  }

  async reload(id: string, encoding?: TextEncoding): Promise<boolean> {
    this.guard(); const document = this.require(id); if (!document.identity) return false;
    if (isDocumentDirty(document)) {
      const beforePrompt = document.revision;
      const choice = await this.ask({ title: "重新加载文件", message: "此文档有未保存修改。", choices: [{ id: "save", label: "先保存" }, { id: "discard", label: "放弃修改", danger: true }] });
      if (choice === "save") { if (!await this.save(id)) return false; }
      else if (choice !== "discard" || this.require(id).revision !== beforePrompt) return false;
    }
    const revision = this.require(id).revision;
    const file = await this.read(document.identity.path, encoding ?? document.metadata.encoding);
    this.guard();
    if (!file || this.require(id).revision !== revision) return false;
    return this.registry.reload(id, file, true);
  }

  async prepareClose(ids: string[]): Promise<ClosePlan | null> {
    this.guard(); const plan: ClosePlan = { documents: [] };
    for (const id of new Set(ids)) {
      const document = this.require(id);
      if (document.saving) return null;
      let discard = false;
      if (isDocumentDirty(document)) {
        const decisionRevision = document.revision;
        const choice = await this.ask({ kind: "saveChanges", title: "保存修改？", message: document.identity?.path ?? "未命名文档", choices: [{ id: "save", label: "保存" }, { id: "discard", label: "放弃修改", danger: true }] });
        if (choice === "save") { if (!await this.save(id)) return null; }
        else if (choice === "discard") {
          if (this.require(id).revision !== decisionRevision) return null;
          discard = true;
        }
        else return null;
      }
      plan.documents.push({ id, revision: this.require(id).revision, discard });
    }
    return this.validClose(plan) ? plan : null;
  }

  validClose(plan: ClosePlan): boolean {
    return this.interaction.allowed() && this.unchangedClose(plan);
  }

  unchangedClose(plan: ClosePlan): boolean {
    return plan.documents.every(({ id, revision, discard }) => {
      const document = this.registry.get(id);
      return !!document && document.revision === revision && !document.saving && (discard || !isDocumentDirty(document));
    });
  }

  private async ask(question: EditorQuestion) {
    this.guard(); const answer = await this.interaction.choose(question); this.guard();
    return question.choices.some((choice) => choice.id === answer) ? answer : null;
  }
  private require(id: string): EditorDocument<M> {
    const document = this.registry.get(id); if (!document) throw new Error("文档已关闭。"); return document;
  }
  private guard() { if (!this.interaction.allowed()) throw new Error("当前不能操作编辑器，请先解锁或关闭对话框。"); }
}
