import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import {
  createSftpOperationId,
  onSftpTransferProgress,
  sftpDownload,
  sftpDownloadTree,
  sftpCancelOperation,
  sftpCreateDir,
  sftpHome,
  sftpRename,
  sftpLocalRename,
  sftpLocalDelete,
  sftpDeleteRecursive,
  sftpCreateFile,
  sftpLocalCreateFile,
  sftpList,
  sftpLocalCreateDir,
  sftpLocalHome,
  sftpLocalList,
  sftpLocalRoots,
  sftpUpload,
  sftpUploadDir,
  type LocalFileEntry,
  type LocalRoot,
  type SftpEntry,
} from "../services/sftpService";
import { isWindows } from "../platform";
import {
  addressText,
  fileNameKey,
  isLocalRoot,
  isRemoteRoot,
  joinLocal,
  joinLocalChild,
  joinRemote,
  localAddressNeedsHome,
  localParent,
  navigationInputAfterFailure,
  remoteParent,
  resolveLocalAddress,
  resolveRemoteAddress,
} from "./browserPaths";
import { Icon } from "../ui/Icon";
import { SftpDialog } from "./SftpDialog";
import { topLevelSelection } from "./recursiveSearch";
import { useRecursiveFileSearch } from "./useRecursiveFileSearch";
import { useNativeFileDrop } from "./useNativeFileDrop";
import { nativeUploadEntries } from "./nativeFileDrop";
import { useFilePaneDrag } from "./useFilePaneDrag";
import { FilePane } from "./FilePane";
import { RemoteFileEditor } from "./RemoteFileEditor";
import type { EditorOptions } from "../settings/settings";
import {
  formatSize,
  visibleEntries,
  rangeSelection,
  visitDirectory,
  type BrowserSide,
  type SortKey,
  type DirectoryHistory,
} from "./fileBrowserModel";

interface FileBrowserProps {
  /** Suppress the native WebView menu when no SFTP context actions exist. */
  disableContextMenu?: boolean;
  profileId: string | null;
  remoteName?: string;
  remoteEndpoint?: string;
  editorOptions: EditorOptions;
  /** Directories restored when an attached workspace tab is mounted again. */
  initialRemotePath?: string;
  initialLocalPath?: string;
  tabId?: string;
  onTabPathsChange?: (
    tabId: string,
    paths: { remotePath?: string; localPath?: string },
  ) => void;
  /** Enter the given remote directory in the active terminal (`cd <dir>`). */
  onOpenInTerminal?: (dir: string) => void;
  onOpenSshTerminal?: () => void;
}

interface TransferState {
  direction: "download" | "upload";
  name: string;
  transferred: number;
  total: number | null;
  completedFiles: number;
  totalFiles: number | null;
}

interface TransferSummary {
  cancelled: boolean;
  completed: number;
  failed: number;
  total: number;
  completedFiles: number;
  totalFiles: number | null;
}

interface PaneEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
}

function validDirectoryName(name: string): boolean {
  return Boolean(name && ![".", ".."].includes(name) && !/[\\/\0]/.test(name));
}

function selectionAfterClick(
  entries: PaneEntry[],
  selected: Set<string>,
  anchor: string | null,
  path: string,
  event: Pick<ReactMouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
): Set<string> {
  if (event.shiftKey && anchor) {
    return new Set(rangeSelection(entries, anchor, path));
  }
  if (event.metaKey || event.ctrlKey) {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  }
  return new Set([path]);
}

/** Count concrete files before starting a transfer. Directories are expanded
 * with the same listing APIs used by the browser; empty directories count as
 * zero because no file payload is transferred for them. */
async function countFiles(
  entries: PaneEntry[],
  listDirectory: (path: string) => Promise<PaneEntry[]>,
): Promise<number[]> {
  const counts: number[] = [];
  for (const entry of entries) {
    let files = 0;
    const pending = [entry];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.isDir && !current.isSymlink) {
        pending.push(...(await listDirectory(current.path)));
      } else {
        files += 1;
      }
    }
    counts.push(files);
  }
  return counts;
}

/** WinSCP-style two-pane SFTP workspace. Remote operations remain inside the
 * verified Rust SFTP client; local paths are only listed after user navigation. */
export function FileBrowser({
  disableContextMenu = false,
  editorOptions,
  initialLocalPath,
  initialRemotePath,
  onOpenInTerminal,
  onOpenSshTerminal,
  onTabPathsChange,
  profileId,
  remoteName,
  remoteEndpoint,
  tabId,
}: FileBrowserProps) {
  // Capture only the mount-time values. Successful navigation updates the tab
  // model, but must not retrigger these initialization effects while mounted.
  const browserRef = useRef<HTMLElement>(null);
  const [sort, setSort] = useState<
    Record<BrowserSide, { key: SortKey; descending: boolean }>
  >({
    remote: { key: "name", descending: false },
    local: { key: "name", descending: false },
  });
  const [showHidden, setShowHidden] = useState(false);
  const [history, setHistory] = useState<Record<BrowserSide, DirectoryHistory>>(
    { remote: { paths: [], index: -1 }, local: { paths: [], index: -1 } },
  );
  const requests = useRef({ remote: 0, local: 0 });
  const [action, setAction] = useState<{
    side: BrowserSide;
    kind: "file" | "rename" | "delete";
    entries: PaneEntry[];
  } | null>(null);
  const [actionName, setActionName] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editors, setEditors] = useState<
    Record<BrowserSide, { paths: string[]; active: string | null }>
  >({
    remote: { paths: [], active: null },
    local: { paths: [], active: null },
  });
  const [editorSide, setEditorSide] = useState<BrowserSide>("remote");
  const [editorVisible, setEditorVisible] = useState(false);
  const [conflict, setConflict] = useState<{
    names: string[];
    resolve: (choice: "overwrite" | "skip" | "cancel") => void;
  } | null>(null);
  const [queue, setQueue] = useState<
    {
      path: string;
      name: string;
      status: "waiting" | "running" | "done" | "failed" | "cancelled";
      error?: string;
    }[]
  >([]);
  const [queueExpanded, setQueueExpanded] = useState(false);
  const initialPathsRef = useRef({
    local: initialLocalPath,
    remote: initialRemotePath,
  });
  const [remotePath, setRemotePath] = useState(initialRemotePath ?? "");
  const [remoteInput, setRemoteInput] = useState(initialRemotePath ?? "");
  const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([]);
  const [localPath, setLocalPath] = useState(initialLocalPath ?? "");
  const [localInput, setLocalInput] = useState(initialLocalPath ?? "");
  const inputsRef = useRef({ remote: remoteInput, local: localInput });
  inputsRef.current = { remote: remoteInput, local: localInput };
  const [localEntries, setLocalEntries] = useState<LocalFileEntry[]>([]);
  const [localRoots, setLocalRoots] = useState<LocalRoot[]>([]);
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<Set<string>>(
    new Set(),
  );
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<Set<string>>(
    new Set(),
  );
  const [recursive, setRecursive] = useState<Record<BrowserSide, boolean>>({
    remote: false,
    local: false,
  });
  const [remoteSearch, setRemoteSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [createDirectorySide, setCreateDirectorySide] = useState<
    "remote" | "local" | null
  >(null);
  const [directoryName, setDirectoryName] = useState("");
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false);
  const [remoteAnchor, setRemoteAnchor] = useState<string | null>(null);
  const [localAnchor, setLocalAnchor] = useState<string | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [transferSummary, setTransferSummary] =
    useState<TransferSummary | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isPreparingTransfer, setIsPreparingTransfer] = useState(false);
  const operationIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const fileProgressRef = useRef({
    completedByOperation: new Map<string, number>(),
    completedPaths: new Set<string>(),
  });

  function completedFileCount() {
    let total = 0;
    for (const count of fileProgressRef.current.completedByOperation.values())
      total += count;
    return total;
  }

  function recordCompletedFile(operationId: string, path: string) {
    const key = `${operationId}\u0000${path}`;
    if (fileProgressRef.current.completedPaths.has(key))
      return completedFileCount();
    fileProgressRef.current.completedPaths.add(key);
    fileProgressRef.current.completedByOperation.set(
      operationId,
      (fileProgressRef.current.completedByOperation.get(operationId) ?? 0) + 1,
    );
    return completedFileCount();
  }

  function completeOperationFiles(operationId: string, fileCount: number) {
    const current =
      fileProgressRef.current.completedByOperation.get(operationId) ?? 0;
    if (fileCount > current)
      fileProgressRef.current.completedByOperation.set(operationId, fileCount);
    return completedFileCount();
  }

  const loadRemote = useCallback(
    async (path: string, historyIndex?: number) => {
      if (!profileId) return;
      const request = ++requests.current.remote;
      const inputAtRequest = inputsRef.current.remote;
      setLoadingRemote(true);
      setError(null);
      try {
        const listing = await sftpList(profileId, path);
        if (request !== requests.current.remote) return;
        setHistory((current) => ({
          ...current,
          remote:
            historyIndex === undefined
              ? visitDirectory(current.remote, listing.path)
              : { ...current.remote, index: historyIndex },
        }));
        setRemotePath(listing.path);
        setRemoteInput((current) =>
          current === inputAtRequest ? listing.path : current,
        );
        setRemoteEntries(listing.entries);
        setSelectedRemotePaths(new Set());
        setRemoteAnchor(null);
        setRemoteSearch("");
        if (tabId) onTabPathsChange?.(tabId, { remotePath: listing.path });
      } catch (reason) {
        if (request === requests.current.remote) {
          setRemoteInput((current) =>
            navigationInputAfterFailure(
              current,
              inputAtRequest,
              currentPaths.current.remote,
            ),
          );
          setError(
            reason instanceof Error ? reason.message : "读取服务器目录失败。",
          );
        }
      } finally {
        if (request === requests.current.remote) setLoadingRemote(false);
      }
    },
    [onTabPathsChange, profileId, tabId],
  );

  const loadLocal = useCallback(
    async (path: string, historyIndex?: number) => {
      const request = ++requests.current.local;
      const inputAtRequest = inputsRef.current.local;
      setLoadingLocal(true);
      setError(null);
      try {
        const listing = await sftpLocalList(path);
        if (request !== requests.current.local) return;
        setHistory((current) => ({
          ...current,
          local:
            historyIndex === undefined
              ? visitDirectory(current.local, listing.path)
              : { ...current.local, index: historyIndex },
        }));
        setLocalPath(listing.path);
        setLocalInput((current) =>
          current === inputAtRequest ? listing.path : current,
        );
        setLocalEntries(listing.entries);
        setSelectedLocalPaths(new Set());
        setLocalAnchor(null);
        setLocalSearch("");
        if (tabId) onTabPathsChange?.(tabId, { localPath: listing.path });
      } catch (reason) {
        if (request === requests.current.local) {
          setLocalInput((current) =>
            navigationInputAfterFailure(
              current,
              inputAtRequest,
              currentPaths.current.local,
            ),
          );
          setError(
            reason instanceof Error ? reason.message : "读取本机目录失败。",
          );
        }
      } finally {
        if (request === requests.current.local) setLoadingLocal(false);
      }
    },
    [onTabPathsChange, tabId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setRemotePath("");
      setRemoteInput("");
      setRemoteEntries([]);
      return;
    }
    const restoredPath = initialPathsRef.current.remote;
    void (restoredPath ? Promise.resolve(restoredPath) : sftpHome(profileId))
      .then((path) => {
        if (!cancelled) void loadRemote(path);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "连接服务器文件系统失败。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [loadRemote, profileId]);

  useEffect(() => {
    let cancelled = false;
    const restoredPath = initialPathsRef.current.local;
    void Promise.all([
      restoredPath ? Promise.resolve(restoredPath) : sftpLocalHome(),
      sftpLocalRoots(),
    ])
      .then(([home, roots]) => {
        if (cancelled) return;
        setLocalRoots(roots);
        void loadLocal(home);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "读取本机主目录失败。",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [loadLocal]);

  useEffect(() => {
    const unlisten = onSftpTransferProgress((progress) => {
      if (progress.operationId !== operationIdRef.current) return;
      const completedFiles = progress.done
        ? recordCompletedFile(progress.operationId, progress.path)
        : completedFileCount();
      setTransfer((current) =>
        current
          ? {
              ...current,
              name: progress.name,
              transferred: progress.transferred,
              total: progress.total,
              completedFiles,
            }
          : current,
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const listRemoteSearch = useCallback(
    async (path: string) =>
      profileId ? (await sftpList(profileId, path)).entries : [],
    [profileId],
  );
  const listLocalSearch = useCallback(
    async (path: string) => (await sftpLocalList(path)).entries,
    [],
  );
  const remoteResults = useRecursiveFileSearch({
    root: remotePath,
    rootEntries: remoteEntries,
    side: "remote",
    query: remoteSearch,
    showHidden,
    enabled: recursive.remote && Boolean(profileId) && !loadingRemote,
    list: listRemoteSearch,
  });
  const localResults = useRecursiveFileSearch({
    root: localPath,
    rootEntries: localEntries,
    side: "local",
    query: localSearch,
    showHidden,
    enabled: recursive.local && !loadingLocal,
    list: listLocalSearch,
  });
  const remoteCandidates = remoteResults.active
    ? remoteResults.entries
    : remoteEntries;
  const localCandidates = localResults.active
    ? localResults.entries
    : localEntries;
  const visibleRemoteEntries = useMemo(
    () =>
      visibleEntries(
        remoteCandidates,
        remoteResults.active ? "" : remoteSearch,
        showHidden,
        sort.remote.key,
        sort.remote.descending,
      ),
    [
      remoteCandidates,
      remoteResults.active,
      remoteSearch,
      showHidden,
      sort.remote,
    ],
  );
  const visibleLocalEntries = useMemo(
    () =>
      visibleEntries(
        localCandidates,
        localResults.active ? "" : localSearch,
        showHidden,
        sort.local.key,
        sort.local.descending,
      ),
    [localCandidates, localResults.active, localSearch, showHidden, sort.local],
  );
  const selectedRemote = visibleRemoteEntries.filter((entry) =>
    selectedRemotePaths.has(entry.path),
  );
  const selectedLocal = visibleLocalEntries.filter((entry) =>
    selectedLocalPaths.has(entry.path),
  );

  // A filtered-out file must never be affected by a hidden selection.
  useEffect(() => {
    setSelectedRemotePaths(
      (current) =>
        new Set(
          [...current].filter((path) =>
            visibleRemoteEntries.some((entry) => entry.path === path),
          ),
        ),
    );
  }, [visibleRemoteEntries]);
  useEffect(() => {
    setSelectedLocalPaths(
      (current) =>
        new Set(
          [...current].filter((path) =>
            visibleLocalEntries.some((entry) => entry.path === path),
          ),
        ),
    );
  }, [visibleLocalEntries]);

  function selectRemote(
    entry: PaneEntry,
    event: Pick<ReactMouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) {
    setSelectedRemotePaths((current) =>
      selectionAfterClick(
        visibleRemoteEntries,
        current,
        remoteAnchor,
        entry.path,
        event,
      ),
    );
    if (!event.shiftKey || !remoteAnchor) setRemoteAnchor(entry.path);
  }
  function selectLocal(
    entry: PaneEntry,
    event: Pick<ReactMouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) {
    setSelectedLocalPaths((current) =>
      selectionAfterClick(
        visibleLocalEntries,
        current,
        localAnchor,
        entry.path,
        event,
      ),
    );
    if (!event.shiftKey || !localAnchor) setLocalAnchor(entry.path);
  }

  function beginAction(side: BrowserSide, kind: "file" | "rename" | "delete") {
    if (
      isTransferring ||
      loadingRemote ||
      loadingLocal ||
      actionBusy ||
      transferLock.current
    )
      return;
    const selected = side === "remote" ? selectedRemote : selectedLocal;
    const entries =
      kind === "delete" ? topLevelSelection(selected, side) : selected;
    if (kind !== "file" && !entries.length) return;
    if (
      kind !== "file" &&
      entries.some((entry) =>
        editors[side].paths.some(
          (path) =>
            path === entry.path ||
            path.startsWith(`${entry.path}/`) ||
            path.startsWith(`${entry.path}\\`),
        ),
      )
    ) {
      setError("请先保存并关闭所选项目中的编辑文件，再重命名或删除。");
      return;
    }
    setActionError(null);
    setActionName(kind === "rename" ? entries[0].name : "");
    setAction({ side, kind, entries });
  }

  async function applyAction() {
    if (!action || actionBusy) return;
    const { side, kind, entries } = action;
    const name = actionName.trim();
    if (kind !== "delete" && !validDirectoryName(name)) {
      setActionError("请输入有效名称，不能包含路径分隔符。");
      return;
    }
    const currentPath = side === "remote" ? remotePath : localPath;
    const parent =
      kind === "rename"
        ? side === "remote"
          ? remoteParent(entries[0].path)
          : localParent(entries[0].path)
        : currentPath;
    const existing =
      parent === currentPath
        ? side === "remote"
          ? remoteEntries
          : localEntries
        : [];
    if (
      kind !== "delete" &&
      existing.some(
        (entry) =>
          entry.name === name &&
          (kind !== "rename" || entry.path !== entries[0].path),
      )
    ) {
      setActionError("已存在同名项目，请使用其他名称。");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      if (side === "remote" && !profileId) throw new Error("请先连接服务器。");
      if (kind === "delete") {
        for (const entry of entries) {
          if (side === "remote")
            await sftpDeleteRecursive(profileId!, entry.path);
          else await sftpLocalDelete(entry.path);
          setAction((current) =>
            current
              ? {
                  ...current,
                  entries: current.entries.filter(
                    (item) => item.path !== entry.path,
                  ),
                }
              : current,
          );
        }
      } else if (kind === "rename") {
        if (side === "remote")
          await sftpRename(profileId!, entries[0].path, name);
        else await sftpLocalRename(entries[0].path, joinLocal(parent, name));
      } else {
        if (side === "remote") await sftpCreateFile(profileId!, parent, name);
        else await sftpLocalCreateFile(parent, name);
      }
      setAction(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "操作失败。");
    } finally {
      await (side === "remote"
        ? loadRemote(currentPath)
        : loadLocal(currentPath));
      setActionBusy(false);
    }
  }

  function enterEntry(side: BrowserSide, entry: PaneEntry) {
    if (entry.isDir) {
      void (side === "remote" ? loadRemote(entry.path) : loadLocal(entry.path));
      return;
    }
    setEditors((current) => ({
      ...current,
      [side]: {
        paths: [...new Set([...current[side].paths, entry.path])],
        active: entry.path,
      },
    }));
    setEditorSide(side);
    setEditorVisible(true);
  }

  async function resolveConflicts(
    entries: PaneEntry[],
    destination: PaneEntry[],
    caseInsensitive = false,
  ) {
    const names = new Set(
      destination.map((entry) => fileNameKey(entry.name, caseInsensitive)),
    );
    const conflicts = entries.filter((entry) =>
      names.has(fileNameKey(entry.name, caseInsensitive)),
    );
    if (!conflicts.length) return entries;
    const choice = await new Promise<"overwrite" | "skip" | "cancel">(
      (resolve) =>
        setConflict({ names: conflicts.map((entry) => entry.name), resolve }),
    );
    setConflict(null);
    return choice === "cancel"
      ? []
      : choice === "overwrite"
        ? entries
        : entries.filter((entry) => !conflicts.includes(entry));
  }

  function beginCreateDirectory(side: "remote" | "local") {
    const parentPath = side === "remote" ? remotePath : localPath;
    if (
      !parentPath ||
      isTransferring ||
      loadingRemote ||
      loadingLocal ||
      actionBusy ||
      transferLock.current
    )
      return;
    setError(null);
    setDirectoryName("");
    setActionError(null);
    setCreateDirectorySide(side);
  }

  async function createDirectory() {
    const side = createDirectorySide;
    const parentPath = side === "remote" ? remotePath : localPath;
    const name = directoryName.trim();
    if (!side || !parentPath || isCreatingDirectory) return;
    if (!name) {
      setActionError("请输入目录名。");
      return;
    }
    if (!validDirectoryName(name)) {
      setActionError("目录名不能为空，且不能包含路径分隔符。");
      return;
    }
    const existing = side === "remote" ? remoteEntries : localEntries;
    if (existing.some((entry) => entry.name === name)) {
      setActionError("已存在同名项目。");
      return;
    }
    setActionError(null);
    setIsCreatingDirectory(true);
    try {
      if (side === "remote") {
        if (!profileId) return;
        await sftpCreateDir(profileId, parentPath, name);
        await loadRemote(parentPath);
      } else {
        await sftpLocalCreateDir(parentPath, name);
        await loadLocal(parentPath);
      }
      setCreateDirectorySide(null);
      setDirectoryName("");
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "创建目录失败。",
      );
    } finally {
      setIsCreatingDirectory(false);
    }
  }

  async function runBatch(
    direction: "download" | "upload",
    entries: PaneEntry[],
    countEntryFiles: (entries: PaneEntry[]) => Promise<number[]>,
    transferOne: (entry: PaneEntry, operationId: string) => Promise<void>,
    refresh: () => Promise<void>,
  ) {
    fileProgressRef.current = {
      completedByOperation: new Map(),
      completedPaths: new Set(),
    };
    setIsTransferring(true);
    setQueue(
      entries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        status: "waiting",
      })),
    );
    setQueueExpanded(true);
    cancelRequestedRef.current = false;
    setError(null);
    setTransferSummary(null);
    let completed = 0;
    let failed = 0;
    let firstError: string | null = null;
    let totalFiles: number | null = null;
    try {
      setTransfer({
        direction,
        name: "正在统计文件…",
        transferred: 0,
        total: null,
        completedFiles: 0,
        totalFiles: null,
      });
      const fileCounts = await countEntryFiles(entries);
      totalFiles = fileCounts.reduce((sum, count) => sum + count, 0);
      for (const [index, entry] of entries.entries()) {
        if (cancelRequestedRef.current) break;
        setQueue((current) =>
          current.map((item) =>
            item.path === entry.path ? { ...item, status: "running" } : item,
          ),
        );
        const operationId = createSftpOperationId(direction);
        operationIdRef.current = operationId;
        setTransfer({
          direction,
          name: entry.name,
          transferred: 0,
          total: entry.isDir ? null : entry.size,
          completedFiles: completedFileCount(),
          totalFiles,
        });
        try {
          await transferOne(entry, operationId);
          const completedFiles = completeOperationFiles(
            operationId,
            fileCounts[index],
          );
          setTransfer((current) =>
            current ? { ...current, completedFiles } : current,
          );
          completed += 1;
          setQueue((current) =>
            current.map((item) =>
              item.path === entry.path ? { ...item, status: "done" } : item,
            ),
          );
        } catch (reason) {
          if (cancelRequestedRef.current) break;
          failed += 1;
          const message =
            reason instanceof Error ? reason.message : "传输失败。";
          firstError ??= message;
          setQueue((current) =>
            current.map((item) =>
              item.path === entry.path
                ? { ...item, status: "failed", error: message }
                : item,
            ),
          );
        }
      }
      await refresh();
      if (firstError) setError(firstError);
    } catch (reason) {
      if (!cancelRequestedRef.current) {
        firstError ??=
          reason instanceof Error ? reason.message : "准备传输失败。";
        failed = entries.length - completed;
        setError(firstError);
      }
    } finally {
      setQueue((current) =>
        current.map((item) =>
          item.status === "waiting" || item.status === "running"
            ? {
                ...item,
                status: cancelRequestedRef.current ? "cancelled" : "failed",
                error: firstError ?? undefined,
              }
            : item,
        ),
      );
      operationIdRef.current = null;
      setTransfer(null);
      setTransferSummary({
        cancelled: cancelRequestedRef.current,
        completed,
        failed,
        total: entries.length,
        completedFiles: completedFileCount(),
        totalFiles,
      });
      setIsTransferring(false);
    }
  }

  function cancelTransfer() {
    cancelRequestedRef.current = true;
    const operationId = operationIdRef.current;
    if (operationId) {
      void sftpCancelOperation(operationId).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "取消传输失败。");
      });
    }
  }

  const transferLock = useRef(false);
  async function transferEntries(
    direction: "upload" | "download",
    source: PaneEntry[] | (() => Promise<PaneEntry[]>),
    chooseDirectory = false,
  ) {
    if (
      !profileId ||
      (Array.isArray(source) && !source.length) ||
      !remotePath ||
      (direction === "download" && (!localPath || loadingLocal)) ||
      isTransferring ||
      loadingRemote ||
      actionBusy ||
      transferLock.current
    )
      return;
    transferLock.current = true;
    setIsPreparingTransfer(true);
    const directoryVersions = { ...requests.current };
    const remoteDestination = remotePath;
    let localDestination = localPath;
    try {
      const entries = topLevelSelection(
        typeof source === "function" ? await source() : source,
        direction === "upload" ? "local" : "remote",
      );
      if (!entries.length) return;
      const names = new Set<string>();
      for (const entry of entries) {
        const key = fileNameKey(
          entry.name,
          direction === "download" && isWindows,
        );
        if (names.has(key))
          throw new Error(
            `所选项目中存在同名「${entry.name}」，请分批传输以避免互相覆盖。`,
          );
        names.add(key);
      }
      if (direction === "download" && chooseDirectory) {
        const picked = await open({
          defaultPath: localPath,
          directory: true,
          multiple: false,
          title: "选择下载目录",
        });
        const destination = Array.isArray(picked) ? picked[0] : picked;
        if (!destination) return;
        localDestination = destination;
      }
      // Re-read the destination before checking collisions, including folders
      // created outside this window since its last refresh.
      const destination =
        direction === "upload"
          ? await sftpList(profileId, remoteDestination)
          : await sftpLocalList(localDestination);
      const approved = await resolveConflicts(
        entries,
        destination.entries,
        direction === "download" && isWindows,
      );
      if (!approved.length) return;
      setIsPreparingTransfer(false);
      await runBatch(
        direction,
        approved,
        (items) =>
          countFiles(items, async (path) => {
            if (cancelRequestedRef.current) throw new Error("传输已取消。");
            return direction === "upload"
              ? (await sftpLocalList(path)).entries
              : (await sftpList(profileId, path)).entries;
          }),
        (entry, operationId) =>
          direction === "upload"
            ? entry.isDir && !entry.isSymlink
              ? sftpUploadDir(
                  profileId,
                  entry.path,
                  joinRemote(destination.path, entry.name),
                  operationId,
                )
              : sftpUpload(
                  profileId,
                  entry.path,
                  joinRemote(destination.path, entry.name),
                  operationId,
                )
            : entry.isDir && !entry.isSymlink
              ? sftpDownloadTree(
                  profileId,
                  entry.path,
                  joinLocalChild(destination.path, entry.name),
                  operationId,
                )
              : sftpDownload(
                  profileId,
                  entry.path,
                  joinLocalChild(destination.path, entry.name),
                  operationId,
                ),
        // Background completion must not move the user's current pane.
        async () => {
          if (direction === "upload") {
            if (
              currentPaths.current.remote === destination.path &&
              requests.current.remote === directoryVersions.remote
            )
              await loadRemote(destination.path);
          } else if (
            currentPaths.current.local === destination.path &&
            requests.current.local === directoryVersions.local
          )
            await loadLocal(destination.path);
        },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "准备传输失败。");
    } finally {
      transferLock.current = false;
      setIsPreparingTransfer(false);
    }
  }
  const currentPaths = useRef({ remote: remotePath, local: localPath });
  currentPaths.current = { remote: remotePath, local: localPath };
  function uploadSelected() {
    return transferEntries("upload", selectedLocal);
  }
  function downloadSelected(chooseDirectory = false) {
    return transferEntries("download", selectedRemote, chooseDirectory);
  }

  const paneDrag = useFilePaneDrag({
    root: browserRef,
    disabled:
      !profileId ||
      !remotePath ||
      !localPath ||
      isTransferring ||
      isPreparingTransfer ||
      loadingRemote ||
      loadingLocal ||
      actionBusy ||
      isCreatingDirectory ||
      Boolean(action || conflict || createDirectorySide) ||
      (editorVisible && editors[editorSide].paths.length > 0),
    onSelect: (side, paths) =>
      (side === "remote" ? setSelectedRemotePaths : setSelectedLocalPaths)(
        new Set(paths),
      ),
    onDrop: (source, paths) => {
      const entries = (
        source === "remote" ? remoteCandidates : localCandidates
      ).filter((entry) => paths.includes(entry.path));
      void transferEntries(
        source === "remote" ? "download" : "upload",
        entries,
      );
    },
  });

  const nativeDrop = useNativeFileDrop({
    root: browserRef,
    targetPath: remotePath,
    disabled:
      !profileId ||
      !remotePath ||
      isTransferring ||
      isPreparingTransfer ||
      loadingRemote ||
      actionBusy ||
      isCreatingDirectory ||
      Boolean(action || conflict || createDirectorySide) ||
      (editorVisible && editors[editorSide].paths.length > 0),
    onDrop: (paths) => {
      void transferEntries("upload", () =>
        nativeUploadEntries(paths, sftpLocalList),
      );
    },
    onError: setError,
  });

  async function navigateAddress(side: BrowserSide) {
    const input = inputsRef.current[side];
    const current = currentPaths.current[side];
    const version = requests.current[side];
    const stillCurrent = () =>
      inputsRef.current[side] === input && requests.current[side] === version;
    try {
      const value = addressText(input);
      if (!value) return;
      let resolved: string;
      if (side === "local") {
        const home = localAddressNeedsHome(input)
          ? await sftpLocalHome()
          : undefined;
        resolved = resolveLocalAddress(input, current, {
          windows: isWindows,
          home,
        });
      } else {
        if (!profileId) return;
        const home =
          value === "~" || value.startsWith("~/")
            ? await sftpHome(profileId)
            : undefined;
        resolved = resolveRemoteAddress(input, current, home);
      }
      if (stillCurrent())
        await (side === "local" ? loadLocal(resolved) : loadRemote(resolved));
    } catch (reason) {
      if (!stillCurrent()) return;
      (side === "local" ? setLocalInput : setRemoteInput)((value) =>
        navigationInputAfterFailure(value, input, current),
      );
      setError(reason instanceof Error ? reason.message : "路径格式无效。");
    }
  }

  function pane(side: BrowserSide) {
    const remote = side === "remote";
    const load = remote ? loadRemote : loadLocal;
    const path = remote ? remotePath : localPath;
    const selection = remote ? selectedRemote : selectedLocal;
    return (
      <FilePane
        side={side}
        connectionName={remote ? remoteName : undefined}
        connectionAddress={remote ? remoteEndpoint : undefined}
        entries={remote ? visibleRemoteEntries : visibleLocalEntries}
        totalCount={
          remote
            ? remoteResults.active
              ? remoteResults.scanned
              : remoteEntries.length
            : localResults.active
              ? localResults.scanned
              : localEntries.length
        }
        recursive={recursive[side]}
        searchState={remote ? remoteResults : localResults}
        onRecursive={() =>
          setRecursive((current) => ({ ...current, [side]: !current[side] }))
        }
        onReveal={(entry) =>
          void load(remote ? remoteParent(entry.path) : localParent(entry.path))
        }
        isLoading={remote ? loadingRemote : loadingLocal}
        disabled={actionBusy || isCreatingDirectory}
        mutationsDisabled={isTransferring || isPreparingTransfer}
        path={remote ? remoteInput : localInput}
        currentPath={path}
        search={remote ? remoteSearch : localSearch}
        selectedPaths={remote ? selectedRemotePaths : selectedLocalPaths}
        roots={remote ? undefined : localRoots}
        history={history[side]}
        showHidden={showHidden}
        sort={sort[side]}
        onHistory={(index) => void load(history[side].paths[index], index)}
        onNavigate={(next) => void load(next)}
        onPathSubmit={() => void navigateAddress(side)}
        atRoot={remote ? isRemoteRoot(path) : isLocalRoot(path)}
        onRefresh={() => void load(path)}
        onUp={() => void load(remote ? remoteParent(path) : localParent(path))}
        onHome={() => {
          void (remote && profileId ? sftpHome(profileId) : sftpLocalHome())
            .then((home) => load(home))
            .catch((reason: unknown) =>
              setError(
                reason instanceof Error ? reason.message : "读取主目录失败。",
              ),
            );
        }}
        onSelect={remote ? selectRemote : selectLocal}
        onSelection={remote ? setSelectedRemotePaths : setSelectedLocalPaths}
        onEnter={(entry) => enterEntry(side, entry)}
        onCreate={(file) =>
          file ? beginAction(side, "file") : beginCreateDirectory(side)
        }
        onRename={() => beginAction(side, "rename")}
        onDelete={() => beginAction(side, "delete")}
        onTransfer={() => void (remote ? downloadSelected() : uploadSelected())}
        onDownloadAs={remote ? () => void downloadSelected(true) : undefined}
        onCopy={() => {
          void navigator.clipboard
            .writeText(selection.map((entry) => entry.path).join("\n"))
            .catch(() => setError("复制路径失败，请检查剪贴板权限。"));
        }}
        onBeginDrag={(event, name, paths) =>
          paneDrag.begin(event, side, name, paths)
        }
        isDropTarget={
          paneDrag.preview?.target === side || (remote && nativeDrop.isOver)
        }
        isExternalDropTarget={remote && nativeDrop.isOver}
        onSort={(key) =>
          setSort((current) => ({
            ...current,
            [side]: {
              key,
              descending:
                current[side].key === key ? !current[side].descending : false,
            },
          }))
        }
        onHidden={() => setShowHidden((current) => !current)}
        setSearch={remote ? setRemoteSearch : setLocalSearch}
        setPath={remote ? setRemoteInput : setLocalInput}
      />
    );
  }

  return (
    <section
      ref={browserRef}
      onClickCapture={paneDrag.suppressClick}
      aria-label="SFTP 双栏文件管理器"
      className="sftp-dual-browser"
      onContextMenu={
        disableContextMenu ? (event) => event.preventDefault() : undefined
      }
    >
      <div
        className="sftp-dual-browser__files"
        inert={editorVisible && editors[editorSide].paths.length > 0}
      >
        {pane("remote")}
        <div className="sftp-dual-browser__transfer" aria-label="文件传输操作">
          <button
            aria-label="上传所选本机项目到服务器"
            className="sftp-dual-browser__transfer-button"
            disabled={
              selectedLocal.length === 0 ||
              isTransferring ||
              isPreparingTransfer ||
              loadingRemote ||
              loadingLocal ||
              actionBusy
            }
            onClick={() => void uploadSelected()}
            title="上传到服务器"
            type="button"
          >
            <Icon name="arrowLeft" height="18" width="18" />
          </button>
          <button
            aria-label="下载所选服务器项目到本机"
            className="sftp-dual-browser__transfer-button"
            disabled={
              selectedRemote.length === 0 ||
              isTransferring ||
              isPreparingTransfer ||
              loadingRemote ||
              loadingLocal ||
              actionBusy
            }
            onClick={() => void downloadSelected()}
            title="下载到本机"
            type="button"
          >
            <Icon name="arrowRight" height="18" width="18" />
          </button>
        </div>
        {pane("local")}
        {error ? (
          <p role="alert" className="sftp-dual-browser__error">
            {error}
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => setError(null)}
            >
              <Icon name="close" width="14" height="14" />
            </button>
          </p>
        ) : null}
        <div className="sftp-dual-browser__queue-bar">
          <button
            type="button"
            onClick={() => setQueueExpanded((current) => !current)}
            aria-expanded={queueExpanded}
          >
            <Icon name="chevron-down" width="14" height="14" />
            传输列表
            {queue.length
              ? ` (${queue.filter((item) => item.status === "done").length}/${queue.length})`
              : ""}
          </button>
          <span>
            {isTransferring
              ? "传输中 · 可以继续浏览目录"
              : "拖拽文件到另一侧即可传输"}
          </span>
          {(["remote", "local"] as const).map((side) =>
            editors[side].paths.length ? (
              <button
                key={side}
                type="button"
                onClick={() => {
                  setEditorSide(side);
                  setEditorVisible(true);
                }}
              >
                <Icon name="edit" width="14" height="14" />
                {side === "remote" ? "服务器" : "本机"}编辑 (
                {editors[side].paths.length})
              </button>
            ) : null,
          )}
        </div>
        {queueExpanded ? (
          <div
            className="sftp-dual-browser__queue"
            aria-label="传输列表"
            aria-live="polite"
          >
            {queue.length ? (
              queue.map((item) => (
                <div key={item.path} title={item.error ?? item.path}>
                  <Icon
                    name={
                      item.status === "done"
                        ? "check"
                        : item.status === "failed"
                          ? "info"
                          : "file"
                    }
                    width="14"
                    height="14"
                  />
                  <span>{item.name}</span>
                  <small>
                    {
                      {
                        waiting: "等待中",
                        running: "传输中",
                        done: "已完成",
                        failed: "失败",
                        cancelled: "已取消",
                      }[item.status]
                    }
                    {item.error ? ` · ${item.error}` : ""}
                  </small>
                </div>
              ))
            ) : (
              <p>暂无传输任务。选择文件后上传或下载，支持整个目录。</p>
            )}
          </div>
        ) : null}
        {transfer ? (
          <div className="sftp-dual-browser__progress">
            <span>
              {transfer.direction === "upload" ? "上传" : "下载"}{" "}
              {transfer.name}
            </span>
            <span>
              {transfer.totalFiles === null
                ? "正在统计文件…"
                : `文件 ${Math.min(transfer.completedFiles + 1, transfer.totalFiles)} / ${transfer.totalFiles}`}
            </span>
            <span>
              {formatSize(transfer.transferred)}
              {transfer.total === null
                ? ""
                : ` / ${formatSize(transfer.total)}`}
            </span>
            <progress
              className="sftp-dual-browser__progress-track"
              aria-label="当前文件传输进度"
              max={transfer.total ?? undefined}
              value={transfer.total === null ? undefined : transfer.transferred}
            />
            <button
              className="sftp-dual-browser__cancel"
              onClick={cancelTransfer}
              type="button"
            >
              取消传输
            </button>
          </div>
        ) : null}
        {transferSummary ? (
          <p role="status" className="sftp-dual-browser__summary">
            {transferSummary.cancelled ? "传输已取消：" : "传输完成："}
            {transferSummary.totalFiles === null
              ? `成功 ${transferSummary.completed}，失败 ${transferSummary.failed}，共 ${transferSummary.total} 项。`
              : `已完成 ${transferSummary.completedFiles} / ${transferSummary.totalFiles} 个文件；成功 ${transferSummary.completed}，失败 ${transferSummary.failed} 项。`}
          </p>
        ) : null}
        {onOpenSshTerminal ? <button className="sftp-dual-browser__terminal" type="button" onClick={onOpenSshTerminal}><Icon name="terminalTool" height="14" width="14"/><span>打开 SSH 终端</span></button> : null}
        {onOpenInTerminal && remotePath ? (
          <button
            className="sftp-dual-browser__terminal"
            onClick={() => onOpenInTerminal(remotePath)}
            type="button"
          >
            <Icon name="terminalTool" height="14" width="14" />
            <span>在终端中打开服务器目录</span>
          </button>
        ) : null}
      </div>
      {(["remote", "local"] as const).map((side) =>
        editors[side].paths.length ? (
          <div
            key={side}
            className="sftp-dual-browser__editor"
            hidden={!editorVisible || editorSide !== side}
          >
            <RemoteFileEditor
              profileId={profileId ?? "local"}
              fileSystem={side}
              editorOptions={editorOptions}
              activePath={editors[side].active}
              filePaths={editors[side].paths}
              backLabel="返回文件列表"
              onCloseFile={(path) =>
                setEditors((current) => {
                  const paths = current[side].paths.filter(
                    (item) => item !== path,
                  );
                  return {
                    ...current,
                    [side]: {
                      paths,
                      active:
                        current[side].active === path
                          ? (paths[paths.length - 1] ?? null)
                          : current[side].active,
                    },
                  };
                })
              }
              onSelectFile={(path) =>
                setEditors((current) => ({
                  ...current,
                  [side]: { ...current[side], active: path },
                }))
              }
              onShowTerminal={() => setEditorVisible(false)}
            />
          </div>
        ) : null,
      )}
      {paneDrag.preview
        ? createPortal(
            <div
              className="sftp-dual-browser__drag-preview"
              style={{ left: paneDrag.preview.x, top: paneDrag.preview.y }}
            >
              <Icon
                name={
                  paneDrag.preview.target === "remote"
                    ? "upload"
                    : paneDrag.preview.target === "local"
                      ? "download"
                      : "file"
                }
                width="16"
                height="16"
              />
              <span>
                {paneDrag.preview.name}
                {paneDrag.preview.count > 1
                  ? ` 等 ${paneDrag.preview.count} 项`
                  : ""}
              </span>
              <small>
                {paneDrag.preview.target === "remote"
                  ? "松开上传"
                  : paneDrag.preview.target === "local"
                    ? "松开下载"
                    : "拖到另一侧文件列表"}
              </small>
            </div>,
            document.body,
          )
        : null}
      {conflict ? (
        <SftpDialog onCancel={() => conflict.resolve("cancel")}>
          <div
            className="sftp-create-directory__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sftp-conflict-title"
          >
            <h2 id="sftp-conflict-title">
              目标目录存在 {conflict.names.length} 个同名项目
            </h2>
            <p>
              覆盖会替换同名文件，目录会合并；目录内同名文件也会覆盖。此操作不可撤销。
            </p>
            <p>{conflict.names.join("、")}</p>
            <div className="sftp-create-directory__actions">
              <button
                autoFocus
                type="button"
                onClick={() => conflict.resolve("cancel")}
              >
                取消
              </button>
              <button type="button" onClick={() => conflict.resolve("skip")}>
                跳过同名项目
              </button>
              <button
                type="button"
                onClick={() => conflict.resolve("overwrite")}
              >
                覆盖并继续
              </button>
            </div>
          </div>
        </SftpDialog>
      ) : null}
      {action ? (
        <SftpDialog busy={actionBusy} onCancel={() => setAction(null)}>
          <form
            className="sftp-create-directory__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sftp-action-title"
            onSubmit={(event) => {
              event.preventDefault();
              void applyAction();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !actionBusy) setAction(null);
            }}
          >
            <h2 id="sftp-action-title">
              {action.kind === "delete"
                ? `删除 ${action.entries.length} 个项目？`
                : action.kind === "rename"
                  ? "重命名"
                  : "新建文件"}
            </h2>
            <p>
              {action.side === "remote" ? "服务器" : "本机"} ·{" "}
              {action.kind === "rename" && action.entries[0]
                ? action.side === "remote"
                  ? remoteParent(action.entries[0].path)
                  : localParent(action.entries[0].path)
                : action.side === "remote"
                  ? remotePath
                  : localPath}
            </p>
            {action.kind === "delete" ? (
              <>
                <p>将永久删除所选文件及目录中的全部内容，此操作不可撤销。</p>
                <p>{action.entries.map((entry) => entry.path).join("、")}</p>
              </>
            ) : (
              <label>
                <span>名称</span>
                <input
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  value={actionName}
                  disabled={actionBusy}
                  onChange={(event) => setActionName(event.currentTarget.value)}
                />
              </label>
            )}
            {actionError ? <p role="alert">{actionError}</p> : null}
            <div className="sftp-create-directory__actions">
              <button
                autoFocus={action.kind === "delete"}
                type="button"
                disabled={actionBusy}
                onClick={() => setAction(null)}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={
                  actionBusy || (action.kind !== "delete" && !actionName.trim())
                }
              >
                {actionBusy
                  ? "处理中…"
                  : action.kind === "delete"
                    ? "永久删除"
                    : "确定"}
              </button>
            </div>
          </form>
        </SftpDialog>
      ) : null}
      {createDirectorySide ? (
        <SftpDialog
          busy={isCreatingDirectory}
          onCancel={() => setCreateDirectorySide(null)}
        >
          <form
            aria-labelledby="sftp-create-directory-title"
            className="sftp-create-directory__dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void createDirectory();
            }}
            role="dialog"
            aria-modal="true"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isCreatingDirectory)
                setCreateDirectorySide(null);
            }}
          >
            <h2 id="sftp-create-directory-title">
              新建{createDirectorySide === "remote" ? "服务器" : "本机"}目录
            </h2>
            <p>{createDirectorySide === "remote" ? remotePath : localPath}</p>
            <label>
              <span>目录名</span>
              <input
                autoFocus
                disabled={isCreatingDirectory}
                onChange={(event) =>
                  setDirectoryName(event.currentTarget.value)
                }
                placeholder="例如：备份"
                value={directoryName}
              />
            </label>
            {actionError ? <p role="alert">{actionError}</p> : null}
            <div className="sftp-create-directory__actions">
              <button
                disabled={isCreatingDirectory}
                onClick={() => setCreateDirectorySide(null)}
                type="button"
              >
                取消
              </button>
              <button
                disabled={isCreatingDirectory || !directoryName.trim()}
                type="submit"
              >
                {isCreatingDirectory ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        </SftpDialog>
      ) : null}
    </section>
  );
}
