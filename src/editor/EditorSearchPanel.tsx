import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { Dialog } from "../ui/Dialog";
import { SelectMenu } from "../ui/SelectMenu";
import { startEditorScan, nextEditorScan, cancelEditorScan, filterEditorOpenPaths } from "../services/editorService";
import { EditorFileProvider } from "./fileProvider";
import { MonacoComparisonView, type MonacoDocuments } from "./MonacoDocumentView";
import { compileTextSearch } from "./searchMatch";
import { searchInWorker } from "./searchWorker";
import { DEFAULT_EDITOR_EXCLUDES, runWorkspaceSearch, type ScanApi, type SearchFileResult, type WorkspaceSearchState } from "./searchRunner";
import { applyReplacePlan, type ReplaceOutcome } from "./replacePlan";
const defaultApi: ScanApi = { start: startEditorScan, next: nextEditorScan, cancel: cancelEditorScan, filter: filterEditorOpenPaths };
const reasonLabels: Record<string, string> = { matches: "已达到 2,000 个匹配上限", bytes: "已达到扫描字节预算", memory: "已达到内存预算", directories: "已达到 2,000 个目录上限", entries: "已达到 100,000 项上限", cancelled: "已停止搜索" };
const outcomeLabels: Record<ReplaceOutcome["status"], string> = { memory: "已修改内存，尚未保存", saved: "已落盘", conflict: "冲突，已跳过", failed: "失败", unprocessed: "未处理" };
export function EditorSearchPanel({ registry, provider, enabled, api = defaultApi, onOpen, onClose }: {
  registry: MonacoDocuments; provider: EditorFileProvider; enabled: boolean; api?: ScanApi;
  onOpen(path: string, line: number, column: number, original: string): void; onClose(): void;
}) {
  const [pattern, setPattern] = useState(""); const [replacement, setReplacement] = useState(""); const [replace, setReplace] = useState(false);
  const [regex, setRegex] = useState(false); const [caseSensitive, setCaseSensitive] = useState(false); const [wholeWord, setWholeWord] = useState(false); const [hidden, setHidden] = useState(false);
  const [include, setInclude] = useState(""); const [exclude, setExclude] = useState(DEFAULT_EDITOR_EXCLUDES.join("\n"));
  const [result, setResult] = useState<WorkspaceSearchState | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false); const [retryFailed, setRetryFailed] = useState(false); const [selected, setSelected] = useState("0"); const [inline, setInline] = useState(false); const [outcomes, setOutcomes] = useState<ReplaceOutcome[]>([]); const [applying, setApplying] = useState(false);
  const operation = useRef<AbortController | null>(null); const generation = useRef(0); const allowed = useRef(enabled); allowed.current = enabled;
  const signature = JSON.stringify([pattern, replacement, replace, regex, caseSensitive, wholeWord, hidden, include, exclude]); const searchedSignature = useRef("");
  useEffect(() => () => { generation.current++; operation.current?.abort(); }, []);
  useEffect(() => { if (!enabled) { operation.current?.abort(); setReview(false); } }, [enabled]);
  function stop() { operation.current?.abort(); setBusy(false); setResult((current) => current ? { ...current, reason: "cancelled", complete: false } : null); }
  async function search() {
    if (!allowed.current) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller; const current = ++generation.current;
    setError(null); setOutcomes([]); setReview(false); setResult(null); setBusy(true); searchedSignature.current = signature;
    try {
      const query = { pattern, regex, caseSensitive, wholeWord, ...(replace ? { replacement } : {}) }; compileTextSearch(query);
      const state = await runWorkspaceSearch({ registry, source: provider.workspace.source, request: { workspaceId: provider.workspace.id, content: true, showHidden: hidden, include: include.split(/\n/).map((s) => s.trim()).filter(Boolean), exclude: exclude.split(/\n/).map((s) => s.trim()).filter(Boolean), skipPaths: [] }, query,
        api, match: searchInWorker, signal: controller.signal, allowed: () => allowed.current && current === generation.current,
        update: (state) => { if (current === generation.current && !controller.signal.aborted) setResult(state); } });
      if (current === generation.current && !controller.signal.aborted) setResult(state);
    } catch (reason) { if (current === generation.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "搜索失败。"); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function apply(plan: SearchFileResult[]) {
    if (!allowed.current || !result || searchedSignature.current !== signature) return;
    const controller = new AbortController(); operation.current = controller; setApplying(true); setReview(false); setOutcomes([]);
    try {
      await applyReplacePlan({ plan, source: provider.workspace.source, registry, provider, signal: controller.signal, allowed: () => allowed.current,
        apply: (id, item) => { const model = registry.get(id)!.model; model.pushStackElement(); model.pushEditOperations([], [{ range: model.getFullModelRange(), text: item.result.content! }], () => null); model.pushStackElement(); }, update: setOutcomes });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "替换失败。"); }
    finally { setApplying(false); }
  }
  const plan = result?.files ?? [];
  const reviewPlan = retryFailed ? plan.filter((item) => outcomes.some((outcome) => outcome.path === item.path && outcome.status === "failed")) : plan;
  const selectedFile = reviewPlan[Number(selected)] ?? reviewPlan[0];
  const canPreview = enabled && !busy && !applying && replace && !!result?.complete && !result.reason && !!result.count && searchedSignature.current === signature && plan.every((item) => item.result.content !== undefined && !item.result.truncated);
  const memoryCount = reviewPlan.filter((item) => !!item.documentId).length; const diskCount = reviewPlan.length - memoryCount;
  return <aside className="editor-search" aria-label="目录内容搜索">
    <header><strong>搜索</strong><IconButton label="关闭目录搜索" onClick={onClose}><Icon name="close" /></IconButton></header>
    <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <label>搜索文本<input aria-label="目录搜索文本" value={pattern} maxLength={2048} onChange={(event) => setPattern(event.target.value)} /></label>
      <div className="editor-search__options">
        <IconButton label="区分大小写" aria-pressed={caseSensitive} onClick={() => setCaseSensitive((v) => !v)}><span>Aa</span></IconButton>
        <IconButton label="全词匹配" aria-pressed={wholeWord} onClick={() => setWholeWord((v) => !v)}><span>ab</span></IconButton>
        <IconButton label="正则表达式" aria-pressed={regex} onClick={() => setRegex((v) => !v)}><span>.*</span></IconButton>
        <IconButton label="搜索隐藏文件" aria-pressed={hidden} onClick={() => setHidden((v) => !v)}><Icon name="eye" /></IconButton>
        <Button variant="ghost" aria-pressed={replace} onClick={() => setReplace((v) => !v)}>替换</Button>
      </div>
      {replace ? <label>替换为<input aria-label="目录替换文本" value={replacement} maxLength={2048} onChange={(event) => setReplacement(event.target.value)} /></label> : null}
      <details><summary>包含与排除</summary><label>包含 glob（每行一项）<textarea aria-label="包含 glob" rows={2} value={include} onChange={(event) => setInclude(event.target.value)} /></label><label>排除 glob（每行一项）<textarea aria-label="排除 glob" rows={3} value={exclude} onChange={(event) => setExclude(event.target.value)} /></label></details>
      <div className="editor-search__actions"><Button variant="ghost" disabled={!enabled || busy || applying || !pattern || !provider.workspace.rootPath} type="submit">搜索</Button>{busy ? <Button variant="ghost" onClick={stop}>停止</Button> : null}<Button variant="ghost" disabled={!canPreview} onClick={() => { setRetryFailed(false); setSelected("0"); setReview(true); }}>预览替换</Button></div>
    </form>
    {error ? <p role="alert" className="editor-search__error">{error}</p> : null}
    {result ? <div className="editor-search__progress" role="status">{result.count} 个匹配 · {plan.length} 个文件{busy ? " · 搜索中…" : ""}{result.reason ? ` · ${reasonLabels[result.reason] ?? result.reason}` : ""}
      {result.progress ? <small>已扫描 {result.progress.entries} 项 · 不可读 {result.progress.unreadable} · 二进制 {result.progress.binary} · 编码 {result.progress.encoding} · 超限 {result.progress.oversized} · 链接 {result.progress.links}</small> : null}
    </div> : null}
    <div className="editor-search__results">{plan.map((item) => <details key={item.path} open><summary title={item.path}>{item.path} · {item.result.matches.length}{item.documentId ? " · 内存" : ""}</summary>{item.result.matches.map((match, index) => <Button variant="ghost" key={index} title={`${match.line}:${match.column}`} onClick={() => onOpen(item.path, match.line, match.column, item.original)}><small>{match.line}:{match.column}</small><span>{match.preview}</span></Button>)}</details>)}
      {result?.failures.map((failure) => <p key={failure.path}>{failure.path}：{failure.message}</p>)}
      {outcomes.length ? <section aria-label="替换结果"><strong>替换结果</strong>{outcomes.map((item) => <p key={item.path}>{item.path} · {outcomeLabels[item.status]}{item.message ? `：${item.message}` : ""}</p>)}</section> : null}
    </div>
    {applying ? <Button variant="ghost" onClick={() => operation.current?.abort()}>停止后续替换</Button> : null}
    {!applying && outcomes.some((item) => item.status === "failed") ? <Button variant="ghost" disabled={!enabled} onClick={() => { if (canPreview) { setRetryFailed(true); setSelected("0"); setReview(true); } }}>重新确认失败项</Button> : null}
    {review && selectedFile ? <Dialog title="确认目录替换" onClose={() => setReview(false)} footer={<><Button onClick={() => setReview(false)}>取消</Button><Button variant="primary" disabled={!canPreview} onClick={() => void apply(reviewPlan)}>确认应用替换</Button></>}>
      <div className="editor-replace-review"><p>{reviewPlan.reduce((sum, item) => sum + item.result.matches.length, 0)} 个匹配，{memoryCount} 个已打开文档仅修改内存并保持未保存；{diskCount} 个未打开文件将直接落盘。已完成的落盘替换不会因取消自动回滚。</p>
        <SelectMenu ariaLabel="替换预览文件" value={selected} options={reviewPlan.map((item, index) => ({ value: String(index), label: `${item.path}${item.documentId ? " · 内存" : " · 落盘"}` }))} onChange={setSelected} searchable />
        <Button variant="ghost" onClick={() => setInline((v) => !v)}>{inline ? "并排比较" : "内联比较"}</Button>
        <div className="editor-replace-review__diff"><MonacoComparisonView original={selectedFile.original} modified={selectedFile.result.content!} language="plaintext" inline={inline} /></div>
      </div>
    </Dialog> : null}
  </aside>;
}
