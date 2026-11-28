import { useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import type { editor } from "monaco-editor";
import { createPortal } from "react-dom";
import { open as chooseLocalFile, save as chooseLocalSave } from "@tauri-apps/plugin-dialog";
import type { EditorWorkspace, TextEncoding } from "../models/editor";
import type { EditorOptions } from "../settings/settings";
import { loadMonaco } from "../sftp/monacoLoader";
import { EDITOR_LANGUAGE_OPTIONS, languageForPath } from "../sftp/MonacoRemoteEditor";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { EditorFileTabs } from "./EditorFileTabs";
import { EditorWelcome } from "./EditorWelcome";
import { SelectMenu } from "../ui/SelectMenu";
import { DocumentRegistry, fileIdentityKey, isDocumentDirty } from "./documentRegistry";
import { EditorFileProvider } from "./fileProvider";
import { EditorActions, type ClosePlan } from "./editorActions";
import { MonacoDocumentView, MonacoComparisonView, type MonacoDocuments } from "./MonacoDocumentView";
import { EditorFileTree, type EditorFileTreeHandle } from "./EditorFileTree";
import { MAX_EDITOR_GROUPS, emptyGroup, editorGroups, updateGroup, openGroupDocument, closeGroupDocument, splitEditorGroup, resizeEditorSplit, moveGroupDocument, type EditorLayout, type EditorGroup } from "./groupLayout";
import { useEditorDialogs } from "./useEditorDialogs";
import { EditorSidebar } from "./EditorSidebar";
import { EditorActionMenu, type EditorMenuItem } from "./EditorActionMenu";
import { EDITOR_TEXT_COMMANDS, editorCommandSupported } from "./editorCommands";
import { resolveActionShortcut, EDITOR_SHORTCUT_IDS, formatShortcut, shortcutDisplayParts, getShortcutBinding, getShortcutDefinitions, matchesDefaultShortcut, isCommandPaletteShortcut, resolveEditorShortcut, subscribeShortcutBindings, shortcutBindingsSnapshot, type EditorShortcutId } from "../app/shortcuts";
import { FileEntryIcon } from "../sftp/FileEntryIcon";
import { EditorFileManagement, type EditorFileManagementHandle } from "./EditorFileManagement";
import type { FileOperationsApi } from "./fileOperations";
import type { SftpEntry } from "../services/sftpService";
import { EditorSearchPanel } from "./EditorSearchPanel";
import { EditorQuickOpen } from "./EditorQuickOpen";
import type { ScanApi } from "./searchRunner";
import { EditorSymbolBreadcrumbs } from "./EditorSymbolBreadcrumbs";
import { EditorProblems } from "./EditorProblems";
import { useExternalFiles } from "./useExternalFiles";
import { removeEditorGroup } from "./groupLayout";
import { directoryBreadcrumbs } from "../sftp/browserPaths";
import { EditorNavigationHistory, type EditorLocation } from "./navigationHistory";
import { EditorImagePreview } from "./EditorPreview";
import { useMarkdownPreviews } from "./useMarkdownPreviews";
import { EditorMarkdownPane } from "./EditorMarkdownPane";
import { EditorBreadcrumbDirectory } from "./EditorBreadcrumbDirectory";
import { MarkdownDocumentView, type RichMarkdownHandle } from "./MarkdownDocumentView";
import { MarkdownModeSwitch } from "./MarkdownModeSwitch";
import { markdownModeKey, type MarkdownMode } from "./markdownMode";
import { RICH_MARKDOWN_LIMIT } from "./richMarkdownLimit";
import { mapEditorLayout, parseEditorLayoutReference, type EditorLayoutReference } from "./layoutReferences";
import { editorBaseName, editorParentPath, editorWithinRoot } from "./editorPaths";
import { isEditorImage } from "./fileTypes";
import { useNativeEditorMenu } from "./useNativeEditorMenu";
import "./editor.css";

export interface EditorWorkbenchHandle {
  snapshot(includeDiscarded?: boolean): EditorLayoutReference | null;
  commands(): Array<{ id: string; label: string; hint?: string; disabled?: boolean }>;
  execute(id: string): void;
  prepareClose(): Promise<ClosePlan | null>;
  cancelClose(): void;
  validClose(plan: ClosePlan): boolean;
  validFrozenClose(plan: ClosePlan): boolean;
  freeze(): void;
  thaw(): void;
  dirty(): boolean;
  claimEmpty(): boolean;
  newFile(): void;
  save(): Promise<boolean>;
  saveAll(): Promise<unknown>;
  open(path: string): Promise<void>;
}
interface Props {
  nativeChrome?: boolean;
  titlebarContainer?: HTMLElement | null;
  sidebarVisible?: boolean;
  onSidebarVisibleChange?: (visible: boolean) => void;
  workspace: EditorWorkspace;
  title: string;
  options: EditorOptions;
  locked: boolean;
  active: boolean;
  ref?: Ref<EditorWorkbenchHandle>;
  onOpenFolder: (path?: string) => void;
  onDetach?: () => void;
  provider?: EditorFileProvider;
  scanApi?: ScanApi;
  fileOperationsApi?: FileOperationsApi;
  onCommandPalette?: () => void;
  handoffPending?: boolean;
  restore?: EditorLayoutReference;
  onStateChange?: (state: EditorLayoutReference) => void;
  onReady?: (ready: boolean) => void;
  onPreferencesChange?: (patch: Partial<EditorOptions>) => void;
}
interface Runtime { monaco: Awaited<ReturnType<typeof loadMonaco>>; registry: MonacoDocuments }

export function EditorWorkbench(props: Props) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; let owned: MonacoDocuments | undefined;
    setFailed(false);
    void loadMonaco().then((monaco) => {
      if (!alive) return;
      owned = new DocumentRegistry<editor.ITextModel, editor.ICodeEditorViewState>(props.workspace.id,
        (content, uri) => monaco.editor.createModel(content, "plaintext", monaco.Uri.parse(uri)));
      setRuntime({ monaco, registry: owned });
    }).catch(() => { if (alive) { setFailed(true); props.onReady?.(false); } });
    return () => { alive = false; owned?.dispose(); };
  }, [props.workspace.id, attempt]);
  if (!runtime || runtime.registry.namespace !== props.workspace.id) return <div className="editor-empty" role={failed ? "alert" : "status"}>{failed ? <>编辑器加载失败。<Button onClick={() => setAttempt((value) => value + 1)}>重试</Button></> : "正在打开编辑器…"}</div>;
  return <WorkbenchBody {...props} runtime={runtime} />;
}

function WorkbenchBody({ workspace, title, options: baseOptions, locked, active, ref, onOpenFolder, onDetach, provider: supplied, scanApi, fileOperationsApi, onCommandPalette, onPreferencesChange, handoffPending, restore, onStateChange, onReady, runtime, sidebarVisible, onSidebarVisibleChange, nativeChrome = false, titlebarContainer }: Props & { runtime: Runtime }) {
  const { registry } = runtime;
  const rootRef = useRef<HTMLElement>(null);
  const sidebarMenuRef = useRef<HTMLButtonElement>(null);
  const [markdownModes, setMarkdownModes] = useState<Record<string, MarkdownMode>>({});
  const [preferenceOverrides, setPreferenceOverrides] = useState<Partial<EditorOptions>>({});
  const options = { ...baseOptions, ...preferenceOverrides };
  function changePreferences(patch: Partial<EditorOptions>) { if (onPreferencesChange) onPreferencesChange(patch); else setPreferenceOverrides((current) => ({ ...current, ...patch })); }
  const documentRoot = globalThis.document;
  const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  useSyncExternalStore(subscribeShortcutBindings, shortcutBindingsSnapshot);
  const [restoring, setRestoring] = useState(Boolean(restore));
  const restored = useRef(!restore);
  const readyReported = useRef(false);
  const restoreLocations = useRef(restore ? parseEditorLayoutReference(restore)?.locations : undefined);
  const [layout, setLayoutState] = useState<EditorLayout>(() => emptyGroup("main"));
  const [focused, setFocused] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const pendingOperations = useRef(0);
  const [closingFiles, setClosingFiles] = useState(false);
  const closingFilesRef = useRef(false);
  const handoffState = useRef(handoffPending); handoffState.current = handoffPending;
  const [localSidebar, setLocalSidebar] = useState(true);
  const sidebar = sidebarVisible ?? localSidebar;
  const setSidebar = (next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(sidebar) : next;
    if (onSidebarVisibleChange) onSidebarVisibleChange(value); else setLocalSidebar(value);
  };
  const [searchPanel, setSearchPanel] = useState(false);
  const [treeSelection, setTreeSelection] = useState<SftpEntry[]>([]);
  const [treeRevision, setTreeRevision] = useState(0);
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationBusyRef = useRef(false);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureState = useRef<() => void>(() => {});
  const closeWaiters = useRef(new Map<string, (closed: boolean) => void>());
  const [quickOpen, setQuickOpen] = useState(false);
  const [problems, setProblems] = useState(false);
  const treeRef = useRef<EditorFileTreeHandle>(null);
  const fileManagementRef = useRef<EditorFileManagementHandle>(null);
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [savedTreeUpdate, setSavedTreeUpdate] = useState<{ revision: number; path: string } | null>(null);
  const appliedTreeSave = useRef(0);

  const history = useRef(new EditorNavigationHistory());
  const [, updateHistory] = useState(0);
  const navigating = useRef(false);
  const historyTarget = useRef<string | null>(null);
  const nativeNavigation = useRef<{ from: EditorLocation; expires: number } | null>(null);
  const pendingLocation = useRef<{ id: string; line: number; column: number } | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [comparison, setComparison] = useState<{ id: string; original: string; modified: string } | null>(null);
  const [imagePath, setImagePathState] = useState<string | null>(null);
  const imagePathRef = useRef<string | null>(null);
  function setImagePath(path: string | null) { imagePathRef.current = path; setImagePathState(path); }
  const markdownPreviews = useMarkdownPreviews(registry);
  const previewFocused = useRef(false);
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const [inlineDiff, setInlineDiff] = useState(false);
  const [languages, setLanguages] = useState<Record<string, string>>({});
  const [position, setPosition] = useState({ lineNumber: 1, column: 1 });
  const dialogs = useEditorDialogs(title);
  const dialogsRef = useRef(dialogs); dialogsRef.current = dialogs;
  useNativeEditorMenu(rootRef, active && !locked, (id) => runCommand(id), nativeMenuGroups);
  const allowed = useRef(true); allowed.current = !locked && !frozen;
  useEffect(() => {
    let identities = new Map(registry.list().map(file => [file.id, file.identity ? fileIdentityKey(file.identity) : null]));
    // Observe each registry commit synchronously: save-and-close may remove the
    // document before React renders its newly saved identity.
    return registry.subscribe(() => {
      const next = new Map<string, string | null>();
      let path: string | null = null;
      for (const file of registry.list()) {
        const identity = file.identity ? fileIdentityKey(file.identity) : null;
        next.set(file.id, identity);
        if (identities.has(file.id) && identities.get(file.id) !== identity && file.identity && workspace.rootPath
          && editorWithinRoot(workspace.source, file.identity.path, workspace.rootPath)) path = file.identity.path;
      }
      identities = next;
      if (path) setSavedTreeUpdate(current => ({ revision: (current?.revision ?? 0) + 1, path }));
    });
  }, [registry, workspace.rootPath, workspace.source]);
  useEffect(() => {
    if (!savedTreeUpdate || appliedTreeSave.current === savedTreeUpdate.revision || !active || locked || frozen || handoffPending || mutationBusy || !sidebar || searchPanel) return;
    appliedTreeSave.current = savedTreeUpdate.revision;
    setTreeRevision(value => value + 1);
    void treeRef.current?.reveal(savedTreeUpdate.path, { focus: false });
  }, [savedTreeUpdate, active, locked, frozen, handoffPending, mutationBusy, sidebar, searchPanel]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editors = useRef(new Map<string, editor.IStandaloneCodeEditor>());
  const richEditors = useRef(new Map<string, RichMarkdownHandle>());
  const [richToolbarHosts, setRichToolbarHosts] = useState<Record<string, HTMLDivElement>>({});
  const richToolbarRefs = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  function richToolbarRef(groupId: string) {
    let callback = richToolbarRefs.current.get(groupId);
    if (!callback) {
      callback = element => setRichToolbarHosts(current => {
        if (current[groupId] === element || (!element && !current[groupId])) return current;
        const next = { ...current }; if (element) next[groupId] = element; else delete next[groupId]; return next;
      });
      richToolbarRefs.current.set(groupId, callback);
    }
    return callback;
  }
  function focusGroup(id: string) { if (richEditors.current.has(id)) richEditors.current.get(id)!.focus(); else editors.current.get(id)?.focus(); }
  const subscriptions = useRef(new Map<string, { dispose(): void }[]>());
  const pendingClose = useRef(new Map<string, { revision: number; discard: boolean }>());
  const sequence = useRef(0);
  const recentlyClosed = useRef<string[]>([]);
  const provider = useMemo(() => supplied ?? new EditorFileProvider(workspace), [workspace, supplied]);
  const actions = useMemo(() => new EditorActions(registry, provider, {
    allowed: () => mounted.current && allowed.current,
    choose: (question) => dialogsRef.current.choose(question),
    choosePath: async (initial) => {
      if (workspace.source.kind === "local") return chooseLocalSave({ defaultPath: initial });
      const root = workspace.rootPath ?? "/";
      return dialogsRef.current.path("另存为远程文件", initial.startsWith("/") ? initial : `${root.replace(/\/$/, "")}/${initial}`);
    },
    compare: (id, original, modified) => setComparison({ id, original, modified }),
  }), [registry, provider, workspace]);
  const groups = editorGroups(layout);
  useEffect(() => { const ids = new Set(editorGroups(layout).map(group => group.id)); for (const id of richToolbarRefs.current.keys()) if (!ids.has(id)) richToolbarRefs.current.delete(id); }, [layout]);
  useEffect(() => {
    setMarkdownModes(current => {
      const next: Record<string, MarkdownMode> = {};
      for (const group of groups) {
        for (const id of group.documents) {
          const key = markdownModeKey(group.id, id);
          if (current[key]) next[key] = current[key];
        }
      }
      return Object.keys(next).length === Object.keys(current).length && Object.entries(next).every(([id, mode]) => current[id] === mode) ? current : next;
    });
  }, [layout, snapshot]);
  const currentGroup = groups.find((group) => group.id === focused) ?? groups[0];
  const document = currentGroup?.active ? registry.get(currentGroup.active) : undefined;
  const currentPath = document?.identity?.path ?? null;
  const external = useExternalFiles(registry, provider, groups.map((group) => group.active).filter((id): id is string => !!id && !registry.get(id)?.largeFile), active && !locked && !frozen, !supplied);
  const externalNotice = document ? external.notices.find((notice) => notice.id === document.id) : undefined;
  const focusRef = useRef(focused); focusRef.current = focused;
  const layoutRef = useRef(layout);
  function setLayout(update: EditorLayout | ((current: EditorLayout) => EditorLayout)) {
    const next = typeof update === "function" ? update(layoutRef.current) : update;
    layoutRef.current = next; setLayoutState(next);
  }
  const activeRef = useRef(active); activeRef.current = active;

  function run(operation: Promise<unknown>) {
    setError(null); pendingOperations.current++;
    void operation.then(() => { pendingOperations.current--; }, (reason) => { pendingOperations.current--; if (mounted.current) setError(reason instanceof Error ? reason.message : "编辑器操作失败。"); });
  }
  const dirty = (id: string) => { const document = registry.get(id); return document ? isDocumentDirty(document) : false; };
  function show(id: string, fixed = false, targetGroup?: string) {
    previewFocused.current = false;
    setLayout((current) => {
      if (targetGroup && !editorGroups(current).some(group => group.id === targetGroup)) {
        const file = registry.get(id);
        if (file && !editorGroups(current).some(group => group.documents.includes(id)) && !dirty(id) && !registry.viewCount(id)) registry.close(id);
        return current;
      }
      const groupId = targetGroup ?? (editorGroups(current).some((group) => group.id === focusRef.current) ? focusRef.current : editorGroups(current)[0].id);
      const group = editorGroups(current).find((group) => group.id === groupId)!;
      const next = openGroupDocument(group, id, !fixed, dirty);
      for (const removed of group.documents.filter((item) => !next.documents.includes(item))) {
        const document = registry.get(removed); if (document) pendingClose.current.set(removed, { revision: document.revision, discard: false });
      }
      return updateGroup(current, groupId, () => next);
    });
    setComparison(null); setImagePath(null);
  }
  async function openFile(path: string, fixed = false, targetGroup?: string) {
    if (mutationBusyRef.current || !allowed.current) return;
    if (isEditorImage(path)) { setImagePath(path); setComparison(null); return; }
    pendingOperations.current++;
    try {
      const document = await actions.open(path);
      if (document && mutationBusyRef.current) { if (!registry.viewCount(document.id) && !isDocumentDirty(document)) registry.close(document.id); return; }
      if (document && mounted.current) show(document.id, fixed, targetGroup);
    } finally { pendingOperations.current--; }
  }
  function goToDocument(id: string, line: number, column: number, remember = true) {
    if (remember) { history.current.record({ id, path: registry.get(id)?.identity?.path ?? null, line, column }); updateHistory((n) => n + 1); }
    pendingLocation.current = { id, line, column }; show(id, true);
    const rich = richEditors.current.get(focusRef.current);
    if (rich?.documentId === id) rich.execute("editorRevealSource");
    const instance = editors.current.get(focusRef.current);
    if (instance && instance.getModel() === registry.get(id)?.model) {
      instance.setPosition({ lineNumber: line, column }); instance.revealPositionInCenter({ lineNumber: line, column }); instance.focus(); pendingLocation.current = null;
    }
  }
  useEffect(() => {
    if (!document || navigating.current) return;
    if (historyTarget.current === document.id) { historyTarget.current = null; return; }
    const last = pendingLocation.current?.id === document.id ? pendingLocation.current : null;
    const instance = editors.current.get(focused);
    const position = instance?.getModel() === document.model ? instance.getPosition() : null;
    history.current.record({ id: document.id, path: currentPath, line: last?.line ?? position?.lineNumber ?? 1, column: last?.column ?? position?.column ?? 1 });
    updateHistory((n) => n + 1);
  }, [document?.id]);
  async function navigate(delta: -1 | 1) {
    if (navigating.current || !allowed.current || mutationBusyRef.current) return;
    navigating.current = true; nativeNavigation.current = null;
    try {
      let target = history.current.move(delta);
      while (target) {
        const file = registry.get(target.id) ?? (target.path ? await actions.open(target.path) : null);
        if (file && allowed.current && !mutationBusyRef.current) { historyTarget.current = editorGroups(layoutRef.current).find((group) => group.id === focusRef.current)?.active === file.id ? null : file.id; goToDocument(file.id, target.line, target.column, false); break; }
        target = history.current.move(delta);
      }
    } finally { navigating.current = false; updateHistory((n) => n + 1); }
  }
  const initialRevealed = useRef(false);
  useEffect(() => {
    if (!initialRevealed.current && workspace.rootPath && workspace.initialFile && currentPath === workspace.initialFile && allowed.current) {
      initialRevealed.current = true; setRevealPath(currentPath);
    }
  }, [workspace.rootPath, workspace.initialFile, currentPath]);
  useEffect(() => {
    if (revealPath && sidebar && !searchPanel && active && allowed.current) { void treeRef.current?.reveal(revealPath); setRevealPath(null); }
  }, [revealPath, sidebar, searchPanel, active, locked, frozen]);
  function revealInTree(path: string) { setSidebar(true); setSearchPanel(false); setRevealPath(path); }
  function newFile() { if (mutationBusyRef.current) return; const document = actions.newFile(); show(document.id, true); }
  async function chooseFile() {
    if (mutationBusyRef.current) return;
    const path = workspace.source.kind === "local" ? await chooseLocalFile({ directory: false, multiple: false })
      : await dialogs.path("打开远程文件", workspace.rootPath ?? "/");
    if (typeof path === "string") await openFile(path, true);
  }
  useEffect(() => { if (workspace.initialFile && !restore) run(openFile(workspace.initialFile, true)); }, [workspace.id]);
  useEffect(() => {
    setLayout((current) => {
      let next = current;
      for (const group of editorGroups(current)) if (group.preview && dirty(group.preview)) next = updateGroup(next, group.id, (item) => ({ ...item, preview: null }));
      return next;
    });
  }, [snapshot]);
  useEffect(() => {
    const referenced = new Set(editorGroups(layout).flatMap((group) => group.documents));
    for (const [id, decision] of pendingClose.current) {
      if (referenced.has(id)) { pendingClose.current.delete(id); closeWaiters.current.get(id)?.(false); closeWaiters.current.delete(id); continue; }
      const document = registry.get(id);
      if (!document) { pendingClose.current.delete(id); closeWaiters.current.get(id)?.(true); closeWaiters.current.delete(id); continue; }
      if (document.revision !== decision.revision || (!decision.discard && dirty(id))) { pendingClose.current.delete(id); closeWaiters.current.get(id)?.(false); closeWaiters.current.delete(id); show(id, true); continue; }
      const path = document.identity?.path;
      if (registry.close(id, decision.discard)) {
        pendingClose.current.delete(id); closeWaiters.current.get(id)?.(true); closeWaiters.current.delete(id);
        if (path) recentlyClosed.current = [path, ...recentlyClosed.current.filter((item) => item !== path)].slice(0, 20);
      }
    }
  }, [layout, snapshot]);
  useEffect(() => {
    if (locked) { dialogs.cancel(); setQuickOpen(false); }
    for (const instance of richEditors.current.values()) instance.setReadOnly(locked || frozen || !!handoffPending || !!registry.get(instance.documentId)?.readOnly);
    for (const instance of editors.current.values()) instance.updateOptions({ readOnly: locked || frozen || handoffPending || (instance.getModel() ? registry.list().find((d) => d.model === instance.getModel())?.readOnly : false) });
  }, [locked, frozen, handoffPending]);
  useEffect(() => () => { for (const items of subscriptions.current.values()) for (const item of items) item.dispose(); }, []);

  useImperativeHandle(ref, () => ({
    claimEmpty: () => {
      if (!mounted.current || !allowed.current || handoffPending || restoring || mutationBusyRef.current || pendingOperations.current || workspace.rootPath || workspace.initialFile || registry.list().length || imagePathRef.current || markdownPreviews.count()) return false;
      allowed.current = false; setFrozen(true); return true;
    },
    cancelClose: () => dialogsRef.current.cancel(),
    snapshot: snapshotReferences, commands: commandPaletteItems, execute: runCommand,
    prepareClose: () => { if (closingFilesRef.current) { setError("文件正在关闭，请等待完成后再关闭工作台。"); return Promise.resolve(null); } if (mutationBusyRef.current) { setError("文件操作正在进行，请等待完成或停止后再关闭工作台。"); return Promise.resolve(null); } return actions.prepareClose(registry.list().map((document) => document.id)); },
    validFrozenClose: (plan) => mounted.current && !allowed.current && plan.documents.length === registry.list().length && actions.unchangedClose(plan),
    validClose: (plan) => plan.documents.length === registry.list().length && actions.validClose(plan),
    freeze: () => { allowed.current = false; for (const instance of richEditors.current.values()) instance.setReadOnly(true); for (const instance of editors.current.values()) instance.updateOptions({ readOnly: true }); setFrozen(true); },
    thaw: () => { setFrozen(false); allowed.current = !locked; },
    dirty: () => registry.list().some(isDocumentDirty), newFile,
    save: () => !handoffPending && document ? actions.save(document.id) : Promise.resolve(false),
    saveAll: () => handoffPending ? Promise.resolve([]) : actions.saveAll(), open: async (path) => { await openFile(path, true); if (workspace.rootPath && allowed.current) setRevealPath(path); },
  }));

  function snapshotReferences(includeDiscarded = false): EditorLayoutReference | null {
    const pathFor = (id: string) => {
      const file = registry.get(id); return file?.identity && !file.saving && (includeDiscarded || !isDocumentDirty(file)) ? file.identity.path : null;
    };
    const locations: EditorLayoutReference["locations"] = {};
    for (const group of groups) {
      const instance = editors.current.get(group.id); const path = group.active ? pathFor(group.active) : null;
      const position = instance?.getPosition();
      if (path && position) locations[group.id] = { path, line: position.lineNumber, column: position.column, scrollTop: instance!.getScrollTop(), scrollLeft: instance!.getScrollLeft() };
    }
    return parseEditorLayoutReference({ layout: mapEditorLayout(layout, pathFor), focused, locations });
  }
  useEffect(() => {
    if (restored.current || locked || frozen || !restore) return;
    let alive = true;
    const reference = parseEditorLayoutReference(restore);
    if (!reference) { setRestoring(false); restored.current = true; readyReported.current = true; onReady?.(false); setError("编辑器布局无效，已保留文件来源。 "); return; }
    void (async () => {
      const ids = new Map<string, string>();
      for (const path of new Set(editorGroups(reference.layout).flatMap((group) => group.documents))) {
        const file = await actions.open(path); if (!alive) return;
        if (!file) throw new Error("恢复文件已取消，源工作区仍保留。 ");
        ids.set(path, file.id);
      }
      if (!alive) return;
      let next = mapEditorLayout(reference.layout, (path) => ids.get(path) ?? null);
      if (workspace.initialFile) {
        const file = await actions.open(workspace.initialFile); if (!alive) return;
        if (file) next = updateGroup(next, reference.focused, (group) => openGroupDocument(group, file.id, false, dirty));
      }
      setLayout(next);
      setFocused(reference.focused); focusRef.current = reference.focused;
      // IDs created by the restored layout must not collide with later splits.
      sequence.current = Date.now(); restored.current = true; setRestoring(false);
    })().catch((error) => { if (alive) { setError(error instanceof Error ? error.message : "恢复编辑器失败。"); restored.current = true; setRestoring(false); readyReported.current = true; onReady?.(false); } });
    return () => { alive = false; };
  }, [restore, locked, frozen]);
  function reportReadyWhenMounted() {
    if (!restore || !restored.current || readyReported.current) return;
    const initialized = editorGroups(layoutRef.current).every((group) => !group.active || richEditors.current.get(group.id)?.documentId === group.active || editors.current.get(group.id)?.getModel() === registry.get(group.active)?.model);
    if (initialized) { readyReported.current = true; onReady?.(true); }
  }
  useEffect(reportReadyWhenMounted, [layout, restoring]);
  captureState.current = () => { if (!restoring && restored.current) { const state = snapshotReferences(); if (state) onStateChange?.(state); } };
  function scheduleSnapshot() {
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(() => { snapshotTimer.current = null; captureState.current(); }, 250);
  }
  useEffect(() => { captureState.current(); }, [layout, focused, snapshot, restoring]);
  useEffect(() => () => { if (snapshotTimer.current) clearTimeout(snapshotTimer.current); }, []);
  async function commitDocumentClose(plan: ClosePlan): Promise<boolean> {
    if (!actions.validClose(plan)) return false;
    if (!plan.documents.length) return true;
    const results = plan.documents.map((decision) => new Promise<boolean>((resolve) => {
      closeWaiters.current.set(decision.id, resolve); pendingClose.current.set(decision.id, decision);
    }));
    const ids = new Set(plan.documents.map((item) => item.id));
    setLayout((current) => editorGroups(current).reduce((next, group) => updateGroup(next, group.id, (g) => [...ids].reduce((g, id) => closeGroupDocument(g, id), g)), current));
    return (await Promise.all(results)).every(Boolean);
  }
  useEffect(() => () => { for (const resolve of closeWaiters.current.values()) resolve(false); closeWaiters.current.clear(); }, []);
  async function closeFiles(group: EditorGroup, ids: string[], removeGroup = false): Promise<boolean> {
    if (closingFilesRef.current || mutationBusyRef.current || !allowed.current || handoffState.current) return false;
    const before = editorGroups(layoutRef.current);
    const target = before.find((item) => item.id === group.id); if (!target) return false;
    const closing = ids.filter((id) => target.documents.includes(id));
    const affected = closing.filter((id) => !before.some((other) => other.id !== group.id && other.documents.includes(id)));
    closingFilesRef.current = true; setClosingFiles(true);
    try {
      const plan = await actions.prepareClose(affected);
      if (!plan || !mounted.current || !allowed.current || handoffState.current || !actions.validClose(plan)) return false;
      const current = layoutRef.current; const currentGroups = editorGroups(current);
      const live = currentGroups.find((item) => item.id === group.id); if (!live) return false;
      const newlyUnique = closing.some((id) => live.documents.includes(id) && !currentGroups.some((other) => other.id !== group.id && other.documents.includes(id)) && !plan.documents.some((item) => item.id === id));
      if (newlyUnique || (removeGroup && (live.documents.length !== target.documents.length || live.documents.some((id) => !target.documents.includes(id))))) {
        setError("分组中的文件已变化，请重新关闭。"); return false;
      }
      for (const item of plan.documents) pendingClose.current.set(item.id, { revision: item.revision, discard: item.discard });
      let next = updateGroup(current, group.id, (state) => closing.reduce((state, id) => closeGroupDocument(state, id), state));
      const after = editorGroups(next).find((item) => item.id === group.id)!;
      const collapse = !after.documents.length && currentGroups.length > 1 && (removeGroup || closing.length > 0);
      if (collapse) {
        next = removeEditorGroup(next, group.id)!;
      }
      setLayout(next);
      if (collapse && focusRef.current === group.id) {
        const remaining = editorGroups(next); const adjacent = remaining[Math.min(currentGroups.indexOf(live), remaining.length - 1)].id;
        focusRef.current = adjacent; setFocused(adjacent); focusGroup(adjacent);
      }
      return true;
    } finally { closingFilesRef.current = false; if (mounted.current) setClosingFiles(false); }
  }
  async function closeGroup(group: EditorGroup) { await closeFiles(group, editorGroups(layoutRef.current).find((item) => item.id === group.id)?.documents ?? [], true); }
  function availableCommands(): EditorShortcutId[] {
    return EDITOR_SHORTCUT_IDS.filter((id) => {
      if ((id === "editorQuickOpen" || id === "editorSearch") && !workspace.rootPath) return false;
      if ((id === "editorSplitHorizontal" || id === "editorSplitVertical") && groups.length >= MAX_EDITOR_GROUPS) return false;
      return !["editorSave", "editorSaveAs", "editorCloseFile", "editorFind", "editorReplace", "editorGoToLine"].includes(id) || !!document || (id === "editorCloseFile" && previewFocused.current && !!markdownPreviews.activeId);
    });
  }
  function runCommand(id: string) {
    if (!allowed.current || handoffPending) return;
    if (previewFocused.current && id === "editorCloseFile" && markdownPreviews.activeId) { closeMarkdownPreview(markdownPreviews.activeId); return; }
    if (previewFocused.current && ["undo", "redo"].includes(id)) return;
    const instance = editors.current.get(focused);
    if (id === "editorBack" || id === "editorForward") { run(navigate(id === "editorBack" ? -1 : 1)); return; }
    switch (id) {
      case "editor.action.toggleColumnSelection": if (instance) instance.updateOptions({ columnSelection: !instance.getOption(runtime.monaco.editor.EditorOption.columnSelection) }); return;
      case "editorNewFile": newFile(); return;
      case "editorSave": if (document) run(actions.save(document.id)); return;
      case "editorSaveAs": if (document) run(actions.save(document.id, true)); return;
      case "editorSaveAll": run(actions.saveAll().then((results) => { if (results.some((item) => !item.saved)) setError("部分文件未保存，请检查这些文档。 "); })); return;
      case "editorCloseFile": if (currentGroup.active) run(closeFiles(currentGroup, [currentGroup.active])); return;
      case "editorQuickOpen": if (workspace.rootPath) setQuickOpen(true); return;
      case "editorCommands": if (onCommandPalette) onCommandPalette(); else { instance?.focus(); run(instance?.getAction("editor.action.quickCommand")?.run() ?? Promise.resolve()); } return;
      case "editorSearch": if (workspace.rootPath) { setSidebar(true); setSearchPanel(true); } return;
      case "editorSplitHorizontal": split("horizontal"); return;
      case "editorSplitVertical": split("vertical"); return;
    }
    const nativeId = ({ editorFind: "actions.find", editorReplace: "editor.action.startFindReplaceAction", editorGoToLine: "editor.action.gotoLine" } as Record<string, string>)[id] ?? id;
    if (richEditors.current.get(focusRef.current)?.execute(nativeId)) return;
    const definition = EDITOR_TEXT_COMMANDS.find((command) => command.id === nativeId);
    if (!instance) return; instance.focus();
    if (document && ["editor.action.gotoLine", "editor.action.quickOutline", "editor.action.revealDefinition", "editor.action.jumpToBracket"].includes(nativeId)) {
      const position = instance.getPosition(); if (position) nativeNavigation.current = { from: { id: document.id, path: currentPath, line: position.lineNumber, column: position.column }, expires: Date.now() + 30_000 };
    }
    if (definition?.core || (definition && editorCommandSupported(definition, instance) && definition.command)) instance.trigger("workbench", nativeId, null);
    else { const action = instance.getAction(nativeId); if (action?.isSupported()) run(action.run()); }
  }
  function commandPaletteItems() {
    const instance = editors.current.get(focused);
    return [
      ...getShortcutDefinitions().filter((item) => EDITOR_SHORTCUT_IDS.includes(item.id as EditorShortcutId)).map((item) => ({ id: item.id, label: item.label, hint: formatShortcut(getShortcutBinding(item.id)), disabled: !availableCommands().includes(item.id as EditorShortcutId) })),
      ...[{ id: "editorBack", label: "后退", disabled: !history.current.canBack }, { id: "editorForward", label: "前进", disabled: !history.current.canForward }],
      ...EDITOR_TEXT_COMMANDS.map((command) => ({ id: command.id, label: command.label, disabled: !editorCommandSupported(command, instance) && !(richEditors.current.has(focused) && ["undo", "redo", "editor.action.selectAll"].includes(command.id)) })),
    ];
  }
  function commandItems(category: "edit" | "selection" | "navigate" | "language"): EditorMenuItem[] {
    const instance = editors.current.get(focused);
    return [...(category === "navigate" ? [{ id: "editorBack", label: "后退", disabled: !history.current.canBack, run: () => run(navigate(-1)) }, { id: "editorForward", label: "前进", disabled: !history.current.canForward, run: () => run(navigate(1)) }] : []), ...EDITOR_TEXT_COMMANDS.filter((command) => command.category === category).map((command) => ({ id: command.id, label: command.label,
      disabled: !editorCommandSupported(command, instance) && !(richEditors.current.has(focused) && ["undo", "redo", "editor.action.selectAll"].includes(command.id)), run: () => runCommand(command.id) }))];
  }
  function keyCapture(event: React.KeyboardEvent<HTMLElement>) {
    if (!active || !allowed.current || handoffPending || mutationBusyRef.current || event.nativeEvent.isComposing || event.repeat) return;
    const target = event.target instanceof Element ? event.target : null;
    const blocked = !!documentRoot.querySelector('[aria-modal="true"], [role="menu"], .select-menu__popover, .combobox__menu');
    if (blocked) return;
    if (onSidebarVisibleChange && resolveActionShortcut(event.nativeEvent, ["toggleSidebar"])) { event.preventDefault(); event.stopPropagation(); setSidebar(!sidebar); return; }
    if (onCommandPalette && isCommandPaletteShortcut(event.nativeEvent)) { event.preventDefault(); event.stopPropagation(); onCommandPalette(); return; }
    if (target?.closest(".editor-markdown-pane")) {
      const command = resolveEditorShortcut(event.nativeEvent, EDITOR_SHORTCUT_IDS, { editing: false });
      if (command || EDITOR_SHORTCUT_IDS.some((id) => matchesDefaultShortcut(event.nativeEvent, id))) { event.preventDefault(); event.stopPropagation(); }
      if (command === "editorCloseFile" && markdownPreviews.activeId) closeMarkdownPreview(markdownPreviews.activeId);
      return;
    }
    const editing = !target?.closest(".monaco-editor, .editor-rich-host") && !!target?.closest('input, textarea, select, [contenteditable="true"]');
    const id = resolveEditorShortcut(event.nativeEvent, availableCommands(), { editing });
    if (id) { event.preventDefault(); event.stopPropagation(); runCommand(id); }
    else if (!editing && EDITOR_SHORTCUT_IDS.some((id) => matchesDefaultShortcut(event.nativeEvent, id))) {
      // Prevent Monaco/browser defaults from reviving an app binding that was reassigned.
      event.preventDefault(); event.stopPropagation();
    }
  }
  function fileMenu(group: EditorGroup): EditorMenuItem[] {
    return [
      { id: "splitH", label: "向右拆分当前编辑组", disabled: !group.active || groups.length >= MAX_EDITOR_GROUPS, run: () => split("horizontal") },
      { id: "splitV", label: "向下拆分当前编辑组", disabled: !group.active || groups.length >= MAX_EDITOR_GROUPS, run: () => split("vertical") },
      { id: "reopenEncoding", label: "以其他编码重新打开…", disabled: !document?.identity, run: () => {
        if (!document) return;
        run(dialogs.choose({ title: "以编码重新打开", message: document.identity?.path ?? "", choices: ["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gb18030"].map((id) => ({ id, label: id.toUpperCase() })) }).then((encoding) => encoding ? actions.reload(document.id, encoding as TextEncoding) : false));
      } },
      { id: "pin", label: "固定当前标签", disabled: !group.preview, run: () => setLayout((current) => updateGroup(current, group.id, (g) => ({ ...g, preview: null }))) },
      { id: "close", label: "关闭当前文件", disabled: !group.active, run: () => run(closeFiles(group, group.active ? [group.active] : [])) },
      { id: "others", label: "关闭其他文件", disabled: group.documents.length < 2, run: () => run(closeFiles(group, group.documents.filter((id) => id !== group.active))) },
      { id: "all", label: "关闭组内所有文件", disabled: !group.documents.length, run: () => run(closeFiles(group, group.documents)) },
      { id: "group", label: "关闭编辑分组", disabled: groups.length < 2 || closingFiles, run: () => run(closeGroup(group)) },
      { id: "reopen", label: "重新打开已关闭文件", disabled: !recentlyClosed.current.length, run: () => { const path = recentlyClosed.current.shift(); if (path) run(openFile(path, true)); } },
      ...groups.filter((item) => item.id !== group.id).map((target, index) => ({ id: `focus-${target.id}`, label: `聚焦编辑组 ${index + 1}`, run: () => { setFocused(target.id); focusGroup(target.id); } })),
    ];
  }
  async function compareWith(kind: "disk" | "file") {
    if (!document || document.largeFile || !allowed.current) return;
    const id = document.id;
    const path = kind === "disk" ? document.identity?.path : workspace.source.kind === "local"
      ? await chooseLocalFile({ directory: false, multiple: false }) : await dialogs.path("选择比较文件", workspace.rootPath ?? "/");
    if (typeof path !== "string" || !allowed.current) return;
    const original = await actions.readForComparison(path);
    const current = registry.get(id);
    if (original && current && allowed.current) { setImagePath(null); setComparison({ id, original: original.content, modified: current.model.getValue() }); }
  }
  function split(direction: "horizontal" | "vertical") {
    if (!allowed.current || handoffPending) return;
    if (editorGroups(layoutRef.current).length >= MAX_EDITOR_GROUPS) { setError(`最多同时打开 ${MAX_EDITOR_GROUPS} 个编辑分组，请先关闭一个分组。`); return; }
    const id = `group-${++sequence.current}`;
    // Update the ref synchronously so repeated commands in one event cannot exceed the budget.
    const next = splitEditorGroup(layoutRef.current, focusRef.current, direction, id, `split-${sequence.current}`);
    layoutRef.current = next; focusRef.current = id; setLayout(next); setFocused(id);
  }
  function toggleMarkdownPreview(group: EditorGroup) {
    if (!allowed.current || handoffPending || !group.active) return;
    setComparison(null); setImagePath(null);
    try { markdownPreviews.open(group.active); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法打开 Markdown 预览。"); }
  }
  function closeMarkdownPreview(id: string) {
    if (!allowed.current || handoffState.current) return;
    const last = markdownPreviews.count() === 1;
    markdownPreviews.close(id);
    if (last) { previewFocused.current = false; focusGroup(focusRef.current); }
  }
  function resize(event: React.PointerEvent<HTMLDivElement>, split: Extract<EditorLayout, { kind: "split" }>) {
    if (event.button !== 0) return;
    const parent = event.currentTarget.parentElement!.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    const move = (event: PointerEvent) => setLayout((current) => resizeEditorSplit(current, split.id,
      split.direction === "horizontal" ? (event.clientX - parent.left) / parent.width : (event.clientY - parent.top) / parent.height));
    const end = () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", end); element.removeEventListener("pointercancel", end); };
    element.addEventListener("pointermove", move); element.addEventListener("pointerup", end); element.addEventListener("pointercancel", end);
  }
  function changeMarkdownMode(groupId: string, documentId: string, mode: MarkdownMode) {
    const file = registry.get(documentId);
    if (!file || !allowed.current || handoffState.current || (mode === "rich" && (file.largeFile || file.model.getValueLength() > RICH_MARKDOWN_LIMIT))) return;
    file.model.pushStackElement();
    setMarkdownModes(current => ({ ...current, [markdownModeKey(groupId, documentId)]: mode }));
  }
  function renderLayout(node: EditorLayout): React.ReactNode {
    if (node.kind === "split") return <div className={`editor-split editor-split--${node.direction}`} key={node.id}>
      <div className="editor-split__child" style={{ flex: node.ratio }}>{renderLayout(node.children[0])}</div>
      <div className="editor-split__divider" role="separator" aria-label="调整编辑分组大小" aria-orientation={node.direction === "horizontal" ? "vertical" : "horizontal"} tabIndex={0}
        onPointerDown={(event) => resize(event, node)} onDoubleClick={() => setLayout((current) => resizeEditorSplit(current, node.id, 0.5))}
        onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); setLayout((current) => resizeEditorSplit(current, node.id, event.key === "Home" ? 0.1 : event.key === "End" ? 0.9 : node.ratio + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -0.02 : 0.02))); } }} />
      <div className="editor-split__child" style={{ flex: 1 - node.ratio }}>{renderLayout(node.children[1])}</div>
    </div>;
    const file = node.active ? registry.get(node.active) : undefined;
    const markdownMode = file ? markdownModes[markdownModeKey(node.id, file.id)] ?? "source" : "source";
    const richDisabled = !!file && (file.largeFile || file.model.getValueLength() > RICH_MARKDOWN_LIMIT);
    const breadcrumb = file?.identity ? directoryBreadcrumbs(file.identity.path, workspace.source.kind === "local") : null;
    const insideRoot = !!file?.identity && !!workspace.rootPath && editorWithinRoot(workspace.source, file.identity.path, workspace.rootPath);
    const pathItems = breadcrumb?.items.filter((item) => !insideRoot || editorWithinRoot(workspace.source, item.path, workspace.rootPath!)) ?? [];
    const truncatedPath = breadcrumb?.truncated && (!insideRoot || pathItems[0]?.path !== workspace.rootPath);

    const sourceView = file ? <MonacoDocumentView registry={registry} documentId={file.id} viewId={node.id} language={languages[file.id] ?? languageForPath(file.identity?.path ?? "")}
          options={{ ...options, minimap: { enabled: options.minimap }, readOnly: locked || frozen || handoffPending, bracketPairColorization: { enabled: true }, folding: true }}
          saveShortcut={false} onSave={() => run(actions.save(file.id))} onMount={(instance) => {
            editors.current.set(node.id, instance); for (const item of subscriptions.current.get(node.id) ?? []) item.dispose();
            subscriptions.current.set(node.id, [instance.onDidChangeCursorPosition((event) => { if (focusRef.current === node.id) {
              setPosition(event.position); scheduleSnapshot();
              const location = { id: file.id, path: file.identity?.path ?? null, line: event.position.lineNumber, column: event.position.column };
              const pending = nativeNavigation.current;
              if (!navigating.current && event.source === "code.jump") { history.current.record(location); nativeNavigation.current = null; }
              else if (!navigating.current && event.source === "api" && pending?.from.id === file.id && pending.expires >= Date.now()) {
                history.current.record(pending.from); history.current.record(location); nativeNavigation.current = null;
              }
              history.current.update(location);
            } }), instance.onDidFocusEditorText(() => { setFocused(node.id); const position = instance.getPosition(); if (position) setPosition(position); }), instance.onDidScrollChange(scheduleSnapshot), instance.onDidDispose(() => {
              if (editors.current.get(node.id) === instance) editors.current.delete(node.id);
            })]);
            const savedLocation = restoreLocations.current?.[node.id];
            if (savedLocation && savedLocation.path === file.identity?.path) {
              instance.setPosition({ lineNumber: savedLocation.line, column: savedLocation.column }); instance.setScrollPosition({ scrollTop: savedLocation.scrollTop, scrollLeft: savedLocation.scrollLeft }); delete restoreLocations.current![node.id];
            }
            const location = pendingLocation.current;
            if (location?.id === file.id) { instance.setPosition({ lineNumber: location.line, column: location.column }); instance.revealPositionInCenter({ lineNumber: location.line, column: location.column }); pendingLocation.current = null; }
            if (focusRef.current === node.id) setPosition(instance.getPosition() ?? { lineNumber: 1, column: 1 });
            reportReadyWhenMounted();
            if (activeRef.current && node.id === focusRef.current && editorGroups(layoutRef.current).find((g) => g.id === node.id)?.active === file.id) instance.focus();
          }} /> : null;

    return <section className={`editor-group${node.id === focused ? " is-focused" : ""}`} key={node.id} onFocusCapture={() => { previewFocused.current = false; focusRef.current = node.id; setFocused(node.id); const instance = editors.current.get(node.id); if (instance?.getModel() === file?.model) { const position = instance?.getPosition(); if (position) setPosition(position); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-duo-editor-tab")) event.preventDefault(); }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData("application/x-duo-editor-tab"); if (!raw) return;
        event.preventDefault(); try { const drag = JSON.parse(raw); if (drag.workspace !== workspace.id) return; setLayout((current) => moveGroupDocument(current, drag.id, drag.group, node.id, event.altKey)); setFocused(node.id); } catch { /* Ignore foreign or malformed drag data. */ }
      }}>
      <div className="editor-group__tabs"><EditorFileTabs activeId={node.active} itemsKey={JSON.stringify(node.documents)}>
        {node.documents.map((id) => { const d = registry.get(id); if (!d) return null; const basename = d.identity ? editorBaseName(workspace.source, d.identity.path) : `未命名 ${id}`; const duplicate = node.documents.some((other) => other !== id && (registry.get(other)?.identity ? editorBaseName(workspace.source, registry.get(other)!.identity!.path) : null) === basename); const name = duplicate ? `${basename} · ${d.identity ? editorParentPath(workspace.source, d.identity.path) : ""}` : basename;
          return <div key={id} role="tab" tabIndex={node.active === id ? 0 : -1} aria-selected={node.active === id} draggable
            className={`editor-file-tab${node.active === id ? " is-active" : ""}${node.preview === id ? " is-preview" : ""}`} title={d.identity?.path ?? name}
            onClick={() => { setFocused(node.id); setLayout((current) => updateGroup(current, node.id, (group) => ({ ...group, active: id }))); setComparison(null); }}
            onDoubleClick={() => setLayout((current) => updateGroup(current, node.id, (group) => ({ ...group, preview: group.preview === id ? null : group.preview })))}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "];
              if (!keys.includes(event.key)) return; event.preventDefault();
              const index = node.documents.indexOf(id); const target = event.key === "Home" ? node.documents[0] : event.key === "End" ? node.documents[node.documents.length - 1] : event.key === "ArrowLeft" ? node.documents[(index + node.documents.length - 1) % node.documents.length] : event.key === "ArrowRight" ? node.documents[(index + 1) % node.documents.length] : id;
              setLayout((current) => updateGroup(current, node.id, (group) => ({ ...group, active: target })));
              const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]'); tabs?.[node.documents.indexOf(target)]?.focus();
            }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-duo-editor-tab")) event.preventDefault(); }}
            onDrop={(event) => {
              event.preventDefault(); event.stopPropagation();
              try { const drag = JSON.parse(event.dataTransfer.getData("application/x-duo-editor-tab")); if (drag.workspace === workspace.id) setLayout((current) => moveGroupDocument(current, drag.id, drag.group, node.id, event.altKey, id)); } catch { /* Foreign drag. */ }
            }}
            onDragStart={(event) => event.dataTransfer.setData("application/x-duo-editor-tab", JSON.stringify({ workspace: workspace.id, group: node.id, id }))}>
            <FileEntryIcon name={basename} /><span className="editor-file-tab__name">{name}</span>{dirty(id) ? <span aria-label="未保存" className="editor-dirty">●</span> : null}
            <button aria-label={`关闭 ${name}`} disabled={closingFiles || mutationBusy || locked || frozen || handoffPending} type="button" onClick={(event) => { event.stopPropagation(); run(closeFiles(node, [id])); }}><Icon name="close" width="14" height="14" /></button>
          </div>;
        })}
      </EditorFileTabs><div className="editor-group__actions" role="toolbar" aria-label="文件快捷操作">
        {file && /\.(md|markdown|mdown)$/i.test(file.identity?.path ?? "") ? <MarkdownModeSwitch mode={richDisabled ? "source" : markdownMode} disabled={locked || frozen || !!handoffPending} richDisabled={richDisabled} onChange={mode => changeMarkdownMode(node.id, file.id, mode)} /> : null}
        <IconButton label="保存当前文件" disabled={!file || file.saving || file.readOnly || locked || frozen || handoffPending} onClick={() => file && run(actions.save(file.id))}><Icon name="save" /></IconButton>
        {file && /\.(md|markdown|mdown)$/i.test(file.identity?.path ?? "") ? <IconButton label="Markdown 预览" active={markdownPreviews.has(file.id)} aria-pressed={markdownPreviews.has(file.id)} disabled={file.largeFile || locked || frozen || handoffPending}
          onClick={() => toggleMarkdownPreview(node)}><Icon name="eye" /></IconButton> : null}
        <IconButton label="向右拆分当前编辑组" disabled={!file || locked || frozen || handoffPending || groups.length >= MAX_EDITOR_GROUPS}
          onClick={() => { focusRef.current = node.id; setFocused(node.id); split("horizontal"); }}><Icon name="splitH" /></IconButton>
        <EditorActionMenu label="文件标签操作" icon="ellipsis" disabled={locked || frozen || handoffPending || closingFiles} items={() => fileMenu(node)} />
        {groups.length > 1 ? <IconButton label="关闭编辑分组" disabled={locked || frozen || handoffPending || mutationBusy || closingFiles} onClick={() => run(closeGroup(node))}><Icon name="close" /></IconButton> : null}
      </div></div>
      <nav className="editor-breadcrumb" aria-label="编辑器面包屑" title={file?.identity?.path}>
        {file?.identity ? <>
          <ol className="editor-breadcrumb__path" aria-label="文件路径">
            {truncatedPath ? <li className="editor-breadcrumb__ellipsis" title={file.identity.path} aria-label="已省略上级目录">…</li> : null}
            {pathItems.map((item, index) => {
              const current = index === pathItems.length - 1;
              const canReveal = !!workspace.rootPath && editorWithinRoot(workspace.source, item.path, workspace.rootPath);
              const content = <>{current ? <FileEntryIcon name={item.label} /> : null}<span className="editor-breadcrumb__name">{item.label}</span></>;
              return <li key={item.path} className={current ? "is-current" : undefined}>
                {index > 0 || truncatedPath ? <Icon name="chevron-right" width="12" height="12" /> : null}
                {!current ? <EditorBreadcrumbDirectory key={`${file.id}:${file.identity?.path}`} provider={provider} path={item.path} label={item.label} disabled={!active || locked || frozen || !!handoffPending || mutationBusy} onOpen={path => { run(openFile(path, true, node.id).then(() => { if (focusRef.current === node.id) focusGroup(node.id); })); }} /> : canReveal ? <Button variant="ghost" title={item.path} aria-current="page" disabled={!active || locked || frozen || handoffPending} onClick={() => revealInTree(item.path)}>{content}</Button>
                  : <span className="editor-breadcrumb__label" title={item.path} aria-current="page">{content}</span>}
              </li>;
            })}
          </ol>
          <div className="editor-breadcrumb__symbols">
            <EditorSymbolBreadcrumbs monaco={runtime.monaco} model={file.model} position={node.id === focused ? position : editors.current.get(node.id)?.getPosition() ?? { lineNumber: 1, column: 1 }} enabled={active && !locked && !frozen && !handoffPending && !file.largeFile}
              onSelect={(line, column) => { focusRef.current = node.id; setFocused(node.id); goToDocument(file.id, line, column); }} />
            <EditorActionMenu label="文档符号" icon="tree" disabled={file.largeFile || !active || locked || frozen || handoffPending} items={() => [{ id: "symbols", label: editors.current.get(node.id)?.getAction("editor.action.quickOutline")?.isSupported() ? "转到文档符号…" : "当前语言未提供文档符号", disabled: !editors.current.get(node.id)?.getAction("editor.action.quickOutline")?.isSupported(), run: () => { setFocused(node.id); const instance = editors.current.get(node.id); instance?.focus(); run(instance?.getAction("editor.action.quickOutline")?.run() ?? Promise.resolve()); } }]} />
          </div>
        </> : <span className="editor-breadcrumb__empty">{file ? "未命名文档" : "编辑器"}</span>}
        {file && /\.(md|markdown|mdown)$/i.test(file.identity?.path ?? "") && markdownMode === "rich" && !richDisabled ? <div className="editor-breadcrumb__rich-actions" ref={richToolbarRef(node.id)} /> : null}
      </nav>
      <div className="editor-group__content" data-document={node.active ?? "empty"}><div key={node.active ?? "empty"} className="editor-content-transition" aria-hidden="true" />
        {file ? /\.(md|markdown|mdown)$/i.test(file.identity?.path ?? "") ? <MarkdownDocumentView toolbarContainer={richToolbarHosts[node.id]} registry={registry} documentId={file.id} viewId={node.id} disabled={locked || frozen || !!handoffPending}
          mode={markdownMode} onModeChange={mode => changeMarkdownMode(node.id, file.id, mode)} source={sourceView} onMount={(handle) => { richEditors.current.set(node.id, handle); if (pendingLocation.current?.id === handle.documentId) { handle.execute("editorRevealSource"); return; } reportReadyWhenMounted(); if (activeRef.current && focusRef.current === node.id) handle.focus(); }}
          onUnmount={(handle) => { if (richEditors.current.get(node.id) === handle) richEditors.current.delete(node.id); }} /> : sourceView : <EditorWelcome autoFocus={active && focused === node.id} disabled={locked || frozen || !!handoffPending || mutationBusy} actions={[
            { id: "new", label: "新建文本文件", icon: "fileAdd", shortcut: shortcutDisplayParts(getShortcutBinding("editorNewFile")), run: newFile },
            { id: "open", label: "打开文件", icon: "fileInput", run: () => run(chooseFile()) },
            { id: "folder", label: "打开文件夹", icon: "folderOpen", run: chooseFolder },
            ...(workspace.rootPath ? [{ id: "quick", label: "快捷打开", icon: "search" as const, shortcut: shortcutDisplayParts(getShortcutBinding("editorQuickOpen")), run: () => setQuickOpen(true) }] : []),
            ...(onCommandPalette ? [{ id: "commands", label: "显示所有命令", icon: "command" as const, shortcut: shortcutDisplayParts(getShortcutBinding("commandPalette")), run: () => runCommand("editorCommands") }] : []),
          ]} />}
      </div>
    </section>;
  }

  function chooseFolder() {
    if (workspace.source.kind === "local") onOpenFolder();
    else run(dialogs.path("打开远程目录", workspace.rootPath ?? "/").then((path) => { if (path) onOpenFolder(path); }));
  }
  function comparisonItems(): EditorMenuItem[] {
    return [
      { id: "saved", label: "与已保存版本比较", disabled: !document || document.largeFile, run: () => { if (document) setComparison({ id: document.id, original: document.savedContent, modified: document.model.getValue() }); } },
      { id: "disk", label: "与磁盘版本比较", disabled: !document?.identity || document.largeFile, run: () => run(compareWith("disk")) },
      { id: "file", label: "与另一文件比较…", disabled: !document || document.largeFile, run: () => run(compareWith("file")) },
    ];
  }
  function documentItems(): EditorMenuItem[] {
    return [
      { id: "new", section: "文档", label: "新建文本文件", run: newFile },
      { id: "open", section: "文档", label: "打开文件", run: () => run(chooseFile()) },
      { id: "folder", section: "文档", label: "打开文件夹", run: chooseFolder },
      { id: "save", section: "保存", label: "保存", disabled: !document || document.saving || document.readOnly, run: () => { if (document) run(actions.save(document.id)); } },
      { id: "saveAs", section: "保存", label: "另存为", disabled: !document || document.saving, run: () => { if (document) run(actions.save(document.id, true)); } },
      { id: "saveAll", section: "保存", label: "全部保存", disabled: !registry.list().some((item) => isDocumentDirty(item)), run: () => runCommand("editorSaveAll") },
      { id: "reload", section: "保存", label: "重新加载文件", disabled: !document?.identity || document.saving, run: () => { if (document) run(actions.reload(document.id)); } },
      ...(fileManagementRef.current?.menuItems() ?? []).map((item) => ({ ...item, id: `project-${item.id}`, section: "项目文件" })),
    ];
  }
  function editingItems(): EditorMenuItem[] {
    return (["edit", "selection"] as const).flatMap((category) => commandItems(category).map((item) => ({ ...item, section: category === "edit" ? "正文编辑" : "选择" }))).concat(
      commandItems("navigate").filter((item) => ["actions.find", "editor.action.startFindReplaceAction"].includes(item.id)).map((item) => ({ ...item, section: "查找与替换" })),
    );
  }
  function viewItems(): EditorMenuItem[] {
    return [
      { id: "explorer", section: "面板", label: sidebar && !searchPanel ? "隐藏文件树" : "显示文件树", run: () => { setSidebar((value) => searchPanel || !value); setSearchPanel(false); } },
      { id: "search", section: "面板", label: "目录内容搜索", disabled: !workspace.rootPath, run: () => { setSidebar(true); setSearchPanel(true); } },
      { id: "problems", section: "面板", label: problems ? "隐藏问题面板" : "显示问题面板", run: () => setProblems((value) => !value) },
      { id: "quick", section: "导航", label: "快捷打开", disabled: !workspace.rootPath, run: () => setQuickOpen(true) },
      ...commandItems("navigate").filter((item) => !["actions.find", "editor.action.startFindReplaceAction", "editor.foldAll", "editor.unfoldAll"].includes(item.id)).map((item) => ({ ...item, section: "导航" })),
      { id: "splitH", section: "布局", label: "左右拆分编辑器", disabled: groups.length >= MAX_EDITOR_GROUPS, run: () => split("horizontal") },
      { id: "splitV", section: "布局", label: "上下拆分编辑器", disabled: groups.length >= MAX_EDITOR_GROUPS, run: () => split("vertical") },
      ...commandItems("navigate").filter((item) => ["editor.foldAll", "editor.unfoldAll"].includes(item.id)).map((item) => ({ ...item, section: "正文显示" })),
      { id: "minimap", section: "正文显示", label: options.minimap ? "隐藏缩略图" : "显示缩略图", run: () => changePreferences({ minimap: !options.minimap }) },
      { id: "markdown", section: "预览", label: "Markdown 预览", disabled: !document || document.largeFile || !/\.(md|markdown|mdown)$/i.test(currentPath ?? ""), run: () => toggleMarkdownPreview(currentGroup) },
    ];
  }
  function toolItems(): EditorMenuItem[] {
    return [
      { id: "commands", section: "命令", label: "命令面板", disabled: !onCommandPalette && !document, run: () => runCommand("editorCommands") },
      ...commandItems("language").map((item) => ({ ...item, section: "语言工具" })),
      ...comparisonItems().map((item) => ({ ...item, id: `compare-${item.id}`, section: "文件比较" })),
    ];
  }

  function nativeMenuGroups() {
    const blocked = locked || frozen || !!handoffPending || mutationBusy || closingFiles;
    const guard = (items: EditorMenuItem[]) => items.map(item => ({ ...item, disabled: blocked || item.disabled }));
    return [
      { id: "file", label: "文件", items: guard([...documentItems(), { id: "close", label: "关闭当前文件", disabled: !document && !markdownPreviews.activeId, run: () => { if (previewFocused.current && markdownPreviews.activeId) closeMarkdownPreview(markdownPreviews.activeId); else runCommand("editorCloseFile"); } }]) },
      { id: "edit", label: "编辑", items: guard(editingItems().filter(item => item.section !== "选择")) },
      { id: "selection", label: "选择", items: guard(commandItems("selection")) },
      { id: "view", label: "视图", items: guard([...viewItems().filter(item => item.section !== "导航"), { id: "detach", label: "在独立窗口打开编辑器", disabled: !onDetach, run: () => onDetach?.() }]) },
      { id: "go", label: "转到", items: guard([...viewItems().filter(item => item.id === "quick"), ...commandItems("navigate").filter(item => !["actions.find", "editor.action.startFindReplaceAction", "editor.foldAll", "editor.unfoldAll"].includes(item.id))]) },
      { id: "tools", label: "工具", items: guard(toolItems()) },
    ];
  }

  const searchControl = <button type="button" className="editor-toolbar__source" aria-label="搜索工作区文件" aria-haspopup="dialog" aria-expanded={quickOpen}
    title={`快捷打开 · ${formatShortcut(getShortcutBinding("editorQuickOpen"))}\n${workspace.source.kind === "local" ? "本地" : "SSH/SFTP"} · ${workspace.rootPath ?? title}`}
    disabled={!workspace.rootPath || locked || frozen || handoffPending} onClick={() => setQuickOpen(true)}>
    <Icon name="search" width="16" height="16" /><span className="editor-command-center__label"><span>搜索文件</span><span className="editor-command-center__workspace">{workspace.rootPath ? editorBaseName(workspace.source, workspace.rootPath) : title}</span></span><kbd>{formatShortcut(getShortcutBinding("editorQuickOpen"))}</kbd>
  </button>;

  if (restoring) return <div className="editor-empty" role="status">正在恢复编辑器文件…{dialogs.dialog}</div>;
  return <section ref={rootRef} className="editor-workbench" inert={handoffPending} onKeyDownCapture={keyCapture} aria-label={`文本编辑器 ${title}`}>
    {nativeChrome ? active && titlebarContainer ? createPortal(<div className="editor-titlebar-controls" role="toolbar" aria-label="编辑器标题栏操作">
      <span className="editor-titlebar-controls__navigation"><IconButton label="后退" disabled={!history.current.canBack || locked || frozen || handoffPending} onClick={() => run(navigate(-1))}><Icon name="arrowLeft" /></IconButton><IconButton label="前进" disabled={!history.current.canForward || locked || frozen || handoffPending} onClick={() => run(navigate(1))}><Icon name="arrowRight" /></IconButton></span>
      {searchControl}<IconButton label="在独立窗口打开编辑器" disabled={!onDetach || locked || frozen || handoffPending || mutationBusy} onClick={onDetach}><Icon name="undock" /></IconButton>
    </div>, titlebarContainer) : null : <header className="editor-toolbar" role="toolbar" aria-label="编辑器工具栏">
      <div className="editor-toolbar__group editor-toolbar__navigation" role="group" aria-label="导航">
        <span className="editor-toolbar__compact-hide"><IconButton label="后退" disabled={!history.current.canBack || locked || frozen || handoffPending} onClick={() => run(navigate(-1))}><Icon name="arrowLeft" /></IconButton><IconButton label="前进" disabled={!history.current.canForward || locked || frozen || handoffPending} onClick={() => run(navigate(1))}><Icon name="arrowRight" /></IconButton></span>
      </div>
      <div className="editor-toolbar__group editor-toolbar__menus" role="group" aria-label="编辑器菜单">
        <EditorActionMenu label="文件" disabled={locked || frozen || handoffPending || mutationBusy} items={documentItems} />
        <EditorActionMenu label="编辑" disabled={locked || frozen || handoffPending} items={editingItems} />
        <EditorActionMenu label="视图" triggerRef={sidebarMenuRef} disabled={locked || frozen || handoffPending} items={viewItems} />
        <EditorActionMenu label="工具" disabled={locked || frozen || handoffPending} items={toolItems} />
      </div>

      {searchControl}
      <div className="editor-toolbar__group editor-toolbar__windows" role="group" aria-label="工作台">
        <IconButton label="在独立窗口打开编辑器" disabled={!onDetach || locked || frozen || handoffPending || mutationBusy} onClick={onDetach}><Icon name="undock" /></IconButton>
      </div>
    </header>}
      <EditorFileManagement showTrigger={false} ref={fileManagementRef} onOpen={(path) => run(openFile(path, true))} onCreated={(path, directory) => { revealInTree(path); if (!directory) run(openFile(path, true)); }} workspace={workspace} registry={registry} actions={actions} api={fileOperationsApi} selected={treeSelection} enabled={active && !locked && !frozen && !handoffPending} commitClose={commitDocumentClose} onChanged={() => { setTreeRevision((value) => value + 1); setTreeSelection([]); }} onBusy={(busy) => { mutationBusyRef.current = busy; setMutationBusy(busy); }} />
    {error ? <div role="alert" className="editor-error">{error}<IconButton label="关闭错误提示" onClick={() => setError(null)}><Icon name="close" /></IconButton></div> : null}
    {externalNotice && document ? <div role="status" className="editor-external-notice"><span>{externalNotice.message}</span>
      <Button variant="ghost" disabled={locked || frozen} onClick={() => run(actions.reload(document.id))}>重新加载</Button>
      <Button variant="ghost" disabled={locked || frozen || document.largeFile || externalNotice.kind === "missing"} onClick={() => run(provider.read(document.identity!.path, { encoding: document.metadata.encoding }).then((file) => setComparison({ id: document.id, original: file.content, modified: document.model.getValue() })))}>比较</Button>
      <IconButton label="稍后处理文件变化" onClick={() => external.clear(document.id)}><Icon name="close" /></IconButton>
    </div> : null}
    <div className="editor-workbench__body">
      <EditorSidebar visible={sidebar} disabled={!sidebar || !active || locked || frozen || handoffPending || mutationBusy} onCollapse={() => { setSidebar(false); (documentRoot.querySelector<HTMLButtonElement>("[data-sidebar-details-toggle]") ?? sidebarMenuRef.current)?.focus({ preventScroll: true }); }}>{searchPanel ? <EditorSearchPanel registry={registry} provider={provider} api={scanApi} enabled={sidebar && active && !locked && !frozen && !mutationBusy} onClose={() => setSearchPanel(false)} onOpen={(path, line, column, original) => run(actions.open(path).then((file) => { if (file) { if (file.model.getValue() !== original) throw new Error("搜索结果已过期，请重新搜索。"); goToDocument(file.id, line, column); } }))} /> : <aside className="editor-sidebar" aria-label="编辑器侧栏"><EditorFileTree enabled={sidebar && active && !locked && !frozen && !handoffPending && !mutationBusy} onContextMenu={(entries, anchor) => fileManagementRef.current?.context(entries, anchor)} onCreate={(kind, entries) => fileManagementRef.current?.create(kind, entries)} ref={treeRef} refreshRevision={treeRevision} onSelect={setTreeSelection} provider={provider} activePath={currentPath} onOpen={(path, fixed) => run(openFile(path, fixed))} /></aside>}</EditorSidebar>
      <div className="editor-workbench__editors">{imagePath ? <><header className="editor-comparison__toolbar"><span title={imagePath}>{imagePath}</span><IconButton label="关闭图片预览" onClick={() => setImagePath(null)}><Icon name="close" /></IconButton></header><EditorImagePreview path={imagePath} provider={provider} enabled={active && !locked && !frozen && !handoffPending} /></> : comparison ? <><header className="editor-comparison__toolbar"><span>差异比较</span><Button variant="ghost" onClick={() => diffRef.current?.goToDiff("previous")}>上一个差异</Button><Button variant="ghost" onClick={() => diffRef.current?.goToDiff("next")}>下一个差异</Button><Button variant="ghost" onClick={() => setInlineDiff((value) => !value)}>{inlineDiff ? "并排" : "内联"}</Button><IconButton label="关闭差异比较" onClick={() => { diffRef.current = null; setComparison(null); }}><Icon name="close" /></IconButton></header><div className="editor-comparison"><MonacoComparisonView original={comparison.original} modified={comparison.modified} language={languages[comparison.id] ?? languageForPath(registry.get(comparison.id)?.identity?.path ?? "")} inline={inlineDiff} onMount={(instance) => { diffRef.current = instance; }} /></div></> : <EditorMarkdownPane previews={markdownPreviews} disabled={!active || locked || frozen || !!handoffPending} enabled={active && !locked && !frozen && !handoffPending} onFocus={() => { previewFocused.current = true; }} onClose={closeMarkdownPreview}>{renderLayout(layout)}</EditorMarkdownPane>}{problems ? <EditorProblems monaco={runtime.monaco} registry={registry} onOpen={goToDocument} onClose={() => setProblems(false)} /> : null}</div>
    </div>
    <footer className="editor-statusbar">
      <span>{document?.saving ? "正在保存…" : document?.readOnly ? "只读" : document && dirty(document.id) ? "未保存" : "就绪"}</span>
      {document?.largeFile ? <span>大文件受限模式</span> : null}
      <span className="editor-statusbar__spacer" />
      <EditorActionMenu label={`缩进: ${options.tabSize}`} disabled={locked || frozen} items={() => [
        ...[2, 4, 8].map((size) => ({ id: `tab-${size}`, label: `缩进宽度 ${size}`, run: () => changePreferences({ tabSize: size }) })),
        ...[{ id: "editor.action.indentationToSpaces", label: "将缩进转换为空格" }, { id: "editor.action.indentationToTabs", label: "将缩进转换为制表符" }].map((command) => ({ ...command, disabled: !editors.current.get(focused)?.getAction(command.id)?.isSupported(), run: () => runCommand(command.id) })),
      ]} />
      <Button variant="ghost" aria-pressed={options.wordWrap === "on"} onClick={() => changePreferences({ wordWrap: options.wordWrap === "on" ? "off" : "on" })}>自动换行</Button>
      <Button variant="ghost" aria-pressed={options.renderWhitespace === "all"} onClick={() => changePreferences({ renderWhitespace: options.renderWhitespace === "all" ? "none" : "all" })}>空白</Button><Button variant="ghost" disabled={!document} onClick={() => runCommand("editorGoToLine")}>行 {position.lineNumber}，列 {position.column}</Button>
      {document ? <>
        <SelectMenu ariaLabel="文本语言" disabled={document.largeFile} value={languages[document.id] ?? languageForPath(currentPath ?? "")} options={EDITOR_LANGUAGE_OPTIONS.map((item) => ({ value: item.id, label: item.label }))} searchable onChange={(value) => setLanguages((current) => ({ ...current, [document.id]: value }))} />
        <SelectMenu ariaLabel="文件编码" value={document.metadata.encoding} options={["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gb18030"].map((id) => ({ value: id, label: id.toUpperCase() }))} onChange={(value) => registry.setMetadata(document.id, { encoding: value as TextEncoding, bom: value === "utf-8-bom" || value.startsWith("utf-16") })} />
        <SelectMenu ariaLabel="文件行尾" value={document.metadata.lineEnding} options={[{ value: "lf", label: "LF" }, { value: "crlf", label: "CRLF" }, ...(document.metadata.lineEnding === "mixed" ? [{ value: "mixed", label: "混合行尾" }] : [])]} onChange={(value) => registry.setMetadata(document.id, { lineEnding: value as "lf" | "crlf" })} />
      </> : null}
    </footer>
    {dialogs.dialog}
    {quickOpen ? <EditorQuickOpen workspace={workspace} api={scanApi} onClose={() => setQuickOpen(false)} onOpen={(path) => run(openFile(path, true))} /> : null}
  </section>;
}
