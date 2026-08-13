import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createSftpOperationId,
  onSftpTransferProgress,
  sftpDownload,
  sftpDownloadTree,
  sftpCancelOperation,
  sftpCreateDir,
  sftpHome,
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
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

interface FileBrowserProps {
  /** Suppress the native WebView menu when no SFTP context actions exist. */
  disableContextMenu?: boolean;
  profileId: string | null;
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

function remoteParent(path: string): string {
  if (path === "/" || !path) return "/";
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}

function localParent(path: string): string {
  if (/^[a-zA-Z]:[\\/]?$/.test(path)) return path;
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index === 2 && /^[a-zA-Z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  if (index <= 0) return trimmed.slice(0, 1) || path;
  return trimmed.slice(0, index);
}

function joinRemote(directory: string, name: string): string {
  return directory === "/" ? `/${name}` : `${directory.replace(/\/+$/, "")}/${name}`;
}

function joinLocal(directory: string, name: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function validDirectoryName(name: string): boolean {
  return Boolean(name && ![".", ".."].includes(name) && !/[\\/\0]/.test(name));
}

function selectionAfterClick(
  entries: PaneEntry[],
  selected: Set<string>,
  anchor: string | null,
  path: string,
  event: ReactMouseEvent<HTMLButtonElement>,
): Set<string> {
  if (event.shiftKey && anchor) {
    const start = entries.findIndex((entry) => entry.path === anchor);
    const end = entries.findIndex((entry) => entry.path === path);
    if (start >= 0 && end >= 0) {
      return new Set(entries.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.path));
    }
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
        pending.push(...await listDirectory(current.path));
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
  initialLocalPath,
  initialRemotePath,
  onOpenInTerminal,
  onTabPathsChange,
  profileId,
  tabId,
}: FileBrowserProps) {
  // Capture only the mount-time values. Successful navigation updates the tab
  // model, but must not retrigger these initialization effects while mounted.
  const initialPathsRef = useRef({ local: initialLocalPath, remote: initialRemotePath });
  const [remotePath, setRemotePath] = useState(initialRemotePath ?? "");
  const [remoteInput, setRemoteInput] = useState(initialRemotePath ?? "");
  const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([]);
  const [localPath, setLocalPath] = useState(initialLocalPath ?? "");
  const [localInput, setLocalInput] = useState(initialLocalPath ?? "");
  const [localEntries, setLocalEntries] = useState<LocalFileEntry[]>([]);
  const [localRoots, setLocalRoots] = useState<LocalRoot[]>([]);
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<Set<string>>(new Set());
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<Set<string>>(new Set());
  const [remoteSearch, setRemoteSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [createDirectorySide, setCreateDirectorySide] = useState<"remote" | "local" | null>(null);
  const [directoryName, setDirectoryName] = useState("");
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false);
  const [remoteAnchor, setRemoteAnchor] = useState<string | null>(null);
  const [localAnchor, setLocalAnchor] = useState<string | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [transferSummary, setTransferSummary] = useState<TransferSummary | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const operationIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const fileProgressRef = useRef({
    completedByOperation: new Map<string, number>(),
    completedPaths: new Set<string>(),
  });

  function completedFileCount() {
    let total = 0;
    for (const count of fileProgressRef.current.completedByOperation.values()) total += count;
    return total;
  }

  function recordCompletedFile(operationId: string, path: string) {
    const key = `${operationId}\u0000${path}`;
    if (fileProgressRef.current.completedPaths.has(key)) return completedFileCount();
    fileProgressRef.current.completedPaths.add(key);
    fileProgressRef.current.completedByOperation.set(
      operationId,
      (fileProgressRef.current.completedByOperation.get(operationId) ?? 0) + 1,
    );
    return completedFileCount();
  }

  function completeOperationFiles(operationId: string, fileCount: number) {
    const current = fileProgressRef.current.completedByOperation.get(operationId) ?? 0;
    if (fileCount > current) fileProgressRef.current.completedByOperation.set(operationId, fileCount);
    return completedFileCount();
  }

  const loadRemote = useCallback(async (path: string) => {
    if (!profileId) return;
    setLoadingRemote(true);
    setError(null);
    try {
      const listing = await sftpList(profileId, path);
      setRemotePath(listing.path);
      setRemoteInput(listing.path);
      setRemoteEntries(listing.entries);
      setSelectedRemotePaths(new Set());
      setRemoteAnchor(null);
      setRemoteSearch("");
      if (tabId) onTabPathsChange?.(tabId, { remotePath: listing.path });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取服务器目录失败。");
    } finally {
      setLoadingRemote(false);
    }
  }, [onTabPathsChange, profileId, tabId]);

  const loadLocal = useCallback(async (path: string) => {
    setLoadingLocal(true);
    setError(null);
    try {
      const listing = await sftpLocalList(path);
      setLocalPath(listing.path);
      setLocalInput(listing.path);
      setLocalEntries(listing.entries);
      setSelectedLocalPaths(new Set());
      setLocalAnchor(null);
      setLocalSearch("");
      if (tabId) onTabPathsChange?.(tabId, { localPath: listing.path });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取本机目录失败。");
    } finally {
      setLoadingLocal(false);
    }
  }, [onTabPathsChange, tabId]);

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
      .then((path) => { if (!cancelled) void loadRemote(path); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "连接服务器文件系统失败。");
      });
    return () => { cancelled = true; };
  }, [loadRemote, profileId]);

  useEffect(() => {
    let cancelled = false;
    const restoredPath = initialPathsRef.current.local;
    void Promise.all([restoredPath ? Promise.resolve(restoredPath) : sftpLocalHome(), sftpLocalRoots()])
      .then(([home, roots]) => {
        if (cancelled) return;
        setLocalRoots(roots);
        void loadLocal(home);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "读取本机主目录失败。");
      });
    return () => { cancelled = true; };
  }, [loadLocal]);

  useEffect(() => {
    const unlisten = onSftpTransferProgress((progress) => {
      if (progress.operationId !== operationIdRef.current) return;
      const completedFiles = progress.done
        ? recordCompletedFile(progress.operationId, progress.path)
        : completedFileCount();
      setTransfer((current) => current ? {
        ...current,
        name: progress.name,
        transferred: progress.transferred,
        total: progress.total ?? current.total,
        completedFiles,
      } : current);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  const selectedRemote = remoteEntries.filter((entry) => selectedRemotePaths.has(entry.path));
  const selectedLocal = localEntries.filter((entry) => selectedLocalPaths.has(entry.path));
  const visibleRemoteEntries = filterEntries(remoteEntries, remoteSearch);
  const visibleLocalEntries = filterEntries(localEntries, localSearch);

  function filterEntries(entries: PaneEntry[], query: string) {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalized)) : entries;
  }

  function selectRemote(entry: PaneEntry, event: ReactMouseEvent<HTMLButtonElement>) {
    setSelectedRemotePaths((current) => selectionAfterClick(remoteEntries, current, remoteAnchor, entry.path, event));
    if (!event.shiftKey) setRemoteAnchor(entry.path);
  }

  function selectLocal(entry: PaneEntry, event: ReactMouseEvent<HTMLButtonElement>) {
    setSelectedLocalPaths((current) => selectionAfterClick(localEntries, current, localAnchor, entry.path, event));
    if (!event.shiftKey) setLocalAnchor(entry.path);
  }

  function beginCreateDirectory(side: "remote" | "local") {
    const parentPath = side === "remote" ? remotePath : localPath;
    if (!parentPath || isTransferring) return;
    setError(null);
    setDirectoryName("");
    setCreateDirectorySide(side);
  }

  async function createDirectory() {
    const side = createDirectorySide;
    const parentPath = side === "remote" ? remotePath : localPath;
    const name = directoryName.trim();
    if (!side || !parentPath || isCreatingDirectory) return;
    if (!name) {
      setError("请输入目录名。");
      return;
    }
    if (!validDirectoryName(name)) {
      setError("目录名不能为空，且不能包含路径分隔符。");
      return;
    }
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建目录失败。");
    } finally {
      setIsCreatingDirectory(false);
      setCreateDirectorySide(null);
      setDirectoryName("");
    }
  }

  async function runBatch(
    direction: "download" | "upload",
    entries: PaneEntry[],
    countEntryFiles: (entries: PaneEntry[]) => Promise<number[]>,
    transferOne: (entry: PaneEntry, operationId: string) => Promise<void>,
    refresh: () => Promise<void>,
  ) {
    setIsTransferring(true);
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
      fileProgressRef.current = {
        completedByOperation: new Map(),
        completedPaths: new Set(),
      };
      for (const [index, entry] of entries.entries()) {
        if (cancelRequestedRef.current) break;
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
          const completedFiles = completeOperationFiles(operationId, fileCounts[index]);
          setTransfer((current) => current ? { ...current, completedFiles } : current);
          completed += 1;
        } catch (reason) {
          if (cancelRequestedRef.current) break;
          failed += 1;
          firstError ??= reason instanceof Error ? reason.message : "传输失败。";
        }
      }
      await refresh();
      if (firstError) setError(firstError);
    } catch (reason) {
      firstError ??= reason instanceof Error ? reason.message : "刷新目录失败。";
      setError(firstError);
    } finally {
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

  async function uploadSelected() {
    if (!profileId || selectedLocal.length === 0 || !remotePath || isTransferring) return;
    const conflicts = selectedLocal.filter((entry) => remoteEntries.some((remote) => remote.name === entry.name));
    if (conflicts.length > 0 && !window.confirm(`服务器目录中已有 ${conflicts.length} 个同名项目，文件将覆盖、目录将合并。继续吗？`)) return;
    await runBatch(
      "upload",
      selectedLocal,
      (entries) => countFiles(entries, async (path) => (await sftpLocalList(path)).entries),
      (entry, operationId) => entry.isDir
        ? sftpUploadDir(profileId, entry.path, joinRemote(remotePath, entry.name), operationId)
        : sftpUpload(profileId, entry.path, joinRemote(remotePath, entry.name), operationId),
      () => loadRemote(remotePath),
    );
  }

  async function downloadSelected() {
    if (!profileId || selectedRemote.length === 0 || !localPath || isTransferring) return;
    let picked: string | string[] | null;
    try {
      picked = await open({
        defaultPath: localPath,
        directory: true,
        multiple: false,
        title: "选择下载目录",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开下载目录选择器。");
      return;
    }
    const destination = Array.isArray(picked) ? picked[0] : picked;
    if (!destination) return;
    let destinationListing;
    try {
      destinationListing = await sftpLocalList(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取所选下载目录。");
      return;
    }
    const destinationPath = destinationListing.path;
    const conflicts = selectedRemote.filter((entry) => destinationListing.entries.some((local) => local.name === entry.name));
    if (conflicts.length > 0 && !window.confirm(`本机目录中已有 ${conflicts.length} 个同名项目，文件将覆盖、目录将合并。继续吗？`)) return;
    await runBatch(
      "download",
      selectedRemote,
      (entries) => countFiles(entries, async (path) => (await sftpList(profileId, path)).entries),
      (entry, operationId) => entry.isDir
        ? sftpDownloadTree(profileId, entry.path, joinLocal(destinationPath, entry.name), operationId)
        : sftpDownload(profileId, entry.path, joinLocal(destinationPath, entry.name), operationId),
      () => loadLocal(destinationPath),
    );
  }

  return (
    <section
      aria-label="SFTP 双栏文件管理器"
      className="sftp-dual-browser"
      onContextMenu={disableContextMenu ? (event) => event.preventDefault() : undefined}
    >
      <Pane
        entries={visibleRemoteEntries}
        isLoading={loadingRemote}
        onCreateDirectory={() => beginCreateDirectory("remote")}
        onEnter={(entry) => entry.isDir && void loadRemote(entry.path)}
        onPathSubmit={() => remoteInput.trim() && void loadRemote(remoteInput.trim())}
        onRefresh={() => remotePath && void loadRemote(remotePath)}
        onSelect={selectRemote}
        onUp={() => void loadRemote(remoteParent(remotePath))}
        path={remoteInput}
        selectedPaths={selectedRemotePaths}
        search={remoteSearch}
        setSearch={setRemoteSearch}
        setPath={setRemoteInput}
        side="remote"
        title="服务器"
        upDisabled={!remotePath || remotePath === "/" || loadingRemote}
        createDisabled={!remotePath || loadingRemote || isTransferring}
      />
      <div className="sftp-dual-browser__transfer" aria-label="文件传输操作">
        <button
          aria-label="上传所选本机项目到服务器"
          className="sftp-dual-browser__transfer-button"
          disabled={selectedLocal.length === 0 || isTransferring}
          onClick={() => void uploadSelected()}
          title="上传到服务器"
          type="button"
        >
          <Icon name="arrowLeft" height="18" width="18" />
        </button>
        <button
          aria-label="下载所选服务器项目到本机"
          className="sftp-dual-browser__transfer-button"
          disabled={selectedRemote.length === 0 || isTransferring}
          onClick={() => void downloadSelected()}
          title="下载到本机"
          type="button"
        >
          <Icon name="arrowRight" height="18" width="18" />
        </button>
      </div>
      <Pane
        entries={visibleLocalEntries}
        isLoading={loadingLocal}
        onCreateDirectory={() => beginCreateDirectory("local")}
        onEnter={(entry) => entry.isDir && void loadLocal(entry.path)}
        onPathSubmit={() => localInput.trim() && void loadLocal(localInput.trim())}
        onRefresh={() => localPath && void loadLocal(localPath)}
        onRootSelect={(path) => void loadLocal(path)}
        onSelect={selectLocal}
        onUp={() => void loadLocal(localParent(localPath))}
        path={localInput}
        roots={localRoots}
        selectedPaths={selectedLocalPaths}
        search={localSearch}
        setSearch={setLocalSearch}
        setPath={setLocalInput}
        side="local"
        title="本机"
        upDisabled={!localPath || loadingLocal}
        createDisabled={!localPath || loadingLocal || isTransferring}
      />
      {error ? <p className="sftp-dual-browser__error">{error}</p> : null}
      {transfer ? (
        <div className="sftp-dual-browser__progress">
          <span>{transfer.direction === "upload" ? "上传" : "下载"} {transfer.name}</span>
          <span>
            {transfer.totalFiles === null
              ? "正在统计文件…"
              : `文件 ${Math.min(transfer.completedFiles + 1, transfer.totalFiles)} / ${transfer.totalFiles}`}
          </span>
          <span>{formatSize(transfer.transferred)}{transfer.total === null ? "" : ` / ${formatSize(transfer.total)}`}</span>
          <div className="sftp-dual-browser__progress-track">
            <div
              className="sftp-dual-browser__progress-value"
              style={{ width: transfer.total ? `${Math.min(100, transfer.transferred / transfer.total * 100)}%` : "45%" }}
            />
          </div>
          <button className="sftp-dual-browser__cancel" onClick={cancelTransfer} type="button">
            取消传输
          </button>
        </div>
      ) : null}
      {transferSummary ? (
        <p className="sftp-dual-browser__summary">
          {transferSummary.cancelled ? "传输已取消：" : "传输完成："}
          {transferSummary.totalFiles === null
            ? `成功 ${transferSummary.completed}，失败 ${transferSummary.failed}，共 ${transferSummary.total} 项。`
            : `已完成 ${transferSummary.completedFiles} / ${transferSummary.totalFiles} 个文件；成功 ${transferSummary.completed}，失败 ${transferSummary.failed} 项。`}
        </p>
      ) : null}
      {onOpenInTerminal && remotePath ? (
        <button className="sftp-dual-browser__terminal" onClick={() => onOpenInTerminal(remotePath)} type="button">
          <Icon name="terminalTool" height="14" width="14" />
          <span>在终端中打开服务器目录</span>
        </button>
      ) : null}
      {createDirectorySide ? (
        <div className="sftp-create-directory__backdrop" role="presentation">
          <form
            aria-labelledby="sftp-create-directory-title"
            className="sftp-create-directory__dialog"
            onSubmit={(event) => { event.preventDefault(); void createDirectory(); }}
            role="dialog"
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
                onChange={(event) => setDirectoryName(event.currentTarget.value)}
                placeholder="例如：备份"
                value={directoryName}
              />
            </label>
            <div className="sftp-create-directory__actions">
              <button
                disabled={isCreatingDirectory}
                onClick={() => setCreateDirectorySide(null)}
                type="button"
              >
                取消
              </button>
              <button disabled={isCreatingDirectory || !directoryName.trim()} type="submit">
                {isCreatingDirectory ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

interface PaneProps {
  createDisabled: boolean;
  entries: PaneEntry[];
  isLoading: boolean;
  onCreateDirectory: () => void;
  onEnter: (entry: PaneEntry) => void;
  onPathSubmit: () => void;
  onRefresh: () => void;
  onRootSelect?: (path: string) => void;
  onSelect: (entry: PaneEntry, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onUp: () => void;
  path: string;
  roots?: LocalRoot[];
  search: string;
  selectedPaths: Set<string>;
  setSearch: (query: string) => void;
  setPath: (path: string) => void;
  side: "local" | "remote";
  title: string;
  upDisabled: boolean;
}

function Pane({ createDisabled, entries, isLoading, onCreateDirectory, onEnter, onPathSubmit, onRefresh, onRootSelect, onSelect, onUp, path, roots, search, selectedPaths, setPath, setSearch, side, title, upDisabled }: PaneProps) {
  const rootValue = roots?.some((root) => root.path === path) ? path : "";
  return (
    <section className="sftp-dual-browser__pane" aria-label={`${title}文件列表`}>
      <header className="sftp-dual-browser__pane-header">
        <span><Icon name={side === "remote" ? "ssh" : "monitor"} height="15" width="15" />{title}</span>
        <div>
          {selectedPaths.size > 0 ? <span className="sftp-dual-browser__selection-count">已选 {selectedPaths.size}</span> : null}
          <IconButton disabled={createDisabled} label="新建目录" onClick={onCreateDirectory}><Icon name="folderPlus" /></IconButton>
          <IconButton disabled={upDisabled} label="上一级目录" onClick={onUp}><Icon name="arrowUp" /></IconButton>
          <IconButton disabled={isLoading} label="刷新" onClick={onRefresh}><Icon name="refresh" /></IconButton>
        </div>
      </header>
      <form className="sftp-dual-browser__path" onSubmit={(event) => { event.preventDefault(); onPathSubmit(); }}>
        {roots && onRootSelect ? (
          <select aria-label="本机常用位置" onChange={(event) => event.currentTarget.value && onRootSelect(event.currentTarget.value)} value={rootValue}>
            <option disabled value="">位置</option>
            {roots.map((root) => <option key={root.path} value={root.path}>{root.label}</option>)}
          </select>
        ) : null}
        <input aria-label={`${title}路径`} onChange={(event) => setPath(event.currentTarget.value)} spellCheck={false} value={path} />
      </form>
      <label className="sftp-dual-browser__search">
        <Icon name="search" height="14" width="14" />
        <input
          aria-label={`搜索${title}当前目录`}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="搜索当前目录"
          type="search"
          value={search}
        />
      </label>
      <div aria-multiselectable="true" className="sftp-dual-browser__list" role="listbox">
        {isLoading ? <p>正在读取…</p> : entries.length === 0 ? <p>{search.trim() ? "没有匹配的项目。" : "此目录为空。"}</p> : entries.map((entry) => (
          <button
            aria-selected={selectedPaths.has(entry.path)}
            className="sftp-dual-browser__row"
            data-selected={selectedPaths.has(entry.path)}
            key={entry.path}
            onClick={(event) => onSelect(entry, event)}
            onDoubleClick={() => onEnter(entry)}
            role="option"
            title={`${entry.path}（按 Ctrl/⌘ 或 Shift 多选）`}
            type="button"
          >
            <Icon name={entry.isDir ? "folder" : "file"} height="16" width="16" />
            <span>{entry.name}</span>
            <small>{entry.isDir ? "" : formatSize(entry.size)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
