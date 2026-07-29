import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  createSftpOperationId,
  onSftpTransferProgress,
  sftpDownload,
  sftpDownloadTree,
  sftpHome,
  sftpList,
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
  profileId: string | null;
  /** Enter the given remote directory in the active terminal (`cd <dir>`). */
  onOpenInTerminal?: (dir: string) => void;
}

interface TransferState {
  direction: "download" | "upload";
  name: string;
  transferred: number;
  total: number | null;
}

interface TransferSummary {
  completed: number;
  failed: number;
  total: number;
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

/** WinSCP-style two-pane SFTP workspace. Remote operations remain inside the
 * verified Rust SFTP client; local paths are only listed after user navigation. */
export function FileBrowser({ profileId, onOpenInTerminal }: FileBrowserProps) {
  const [remotePath, setRemotePath] = useState("");
  const [remoteInput, setRemoteInput] = useState("");
  const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([]);
  const [localPath, setLocalPath] = useState("");
  const [localInput, setLocalInput] = useState("");
  const [localEntries, setLocalEntries] = useState<LocalFileEntry[]>([]);
  const [localRoots, setLocalRoots] = useState<LocalRoot[]>([]);
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<Set<string>>(new Set());
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<Set<string>>(new Set());
  const [remoteAnchor, setRemoteAnchor] = useState<string | null>(null);
  const [localAnchor, setLocalAnchor] = useState<string | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [transferSummary, setTransferSummary] = useState<TransferSummary | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const operationIdRef = useRef<string | null>(null);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取服务器目录失败。");
    } finally {
      setLoadingRemote(false);
    }
  }, [profileId]);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取本机目录失败。");
    } finally {
      setLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setRemotePath("");
      setRemoteInput("");
      setRemoteEntries([]);
      return;
    }
    void sftpHome(profileId)
      .then((path) => { if (!cancelled) void loadRemote(path); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "连接服务器文件系统失败。");
      });
    return () => { cancelled = true; };
  }, [loadRemote, profileId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([sftpLocalHome(), sftpLocalRoots()])
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
      setTransfer((current) => current ? {
        ...current,
        transferred: progress.transferred,
        total: progress.total ?? current.total,
      } : current);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  const selectedRemote = remoteEntries.filter((entry) => selectedRemotePaths.has(entry.path));
  const selectedLocal = localEntries.filter((entry) => selectedLocalPaths.has(entry.path));

  function selectRemote(entry: PaneEntry, event: ReactMouseEvent<HTMLButtonElement>) {
    setSelectedRemotePaths((current) => selectionAfterClick(remoteEntries, current, remoteAnchor, entry.path, event));
    if (!event.shiftKey) setRemoteAnchor(entry.path);
  }

  function selectLocal(entry: PaneEntry, event: ReactMouseEvent<HTMLButtonElement>) {
    setSelectedLocalPaths((current) => selectionAfterClick(localEntries, current, localAnchor, entry.path, event));
    if (!event.shiftKey) setLocalAnchor(entry.path);
  }

  async function runBatch(
    direction: "download" | "upload",
    entries: PaneEntry[],
    transferOne: (entry: PaneEntry, operationId: string) => Promise<void>,
    refresh: () => Promise<void>,
  ) {
    setIsTransferring(true);
    setError(null);
    setTransferSummary(null);
    let completed = 0;
    let failed = 0;
    let firstError: string | null = null;
    try {
      for (const [index, entry] of entries.entries()) {
        const operationId = createSftpOperationId(direction);
        operationIdRef.current = operationId;
        setTransfer({
          direction,
          name: entries.length > 1 ? `${entry.name}（${index + 1}/${entries.length}）` : entry.name,
          transferred: 0,
          total: entry.isDir ? null : entry.size,
        });
        try {
          await transferOne(entry, operationId);
          completed += 1;
        } catch (reason) {
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
      setTransferSummary({ completed, failed, total: entries.length });
      setIsTransferring(false);
    }
  }

  async function uploadSelected() {
    if (!profileId || selectedLocal.length === 0 || !remotePath || isTransferring) return;
    const conflicts = selectedLocal.filter((entry) => remoteEntries.some((remote) => remote.name === entry.name));
    if (conflicts.length > 0 && !window.confirm(`服务器目录中已有 ${conflicts.length} 个同名项目，文件将覆盖、目录将合并。继续吗？`)) return;
    await runBatch(
      "upload",
      selectedLocal,
      (entry, operationId) => entry.isDir
        ? sftpUploadDir(profileId, entry.path, joinRemote(remotePath, entry.name), operationId)
        : sftpUpload(profileId, entry.path, joinRemote(remotePath, entry.name), operationId),
      () => loadRemote(remotePath),
    );
  }

  async function downloadSelected() {
    if (!profileId || selectedRemote.length === 0 || !localPath || isTransferring) return;
    const conflicts = selectedRemote.filter((entry) => localEntries.some((local) => local.name === entry.name));
    if (conflicts.length > 0 && !window.confirm(`本机目录中已有 ${conflicts.length} 个同名项目，文件将覆盖、目录将合并。继续吗？`)) return;
    await runBatch(
      "download",
      selectedRemote,
      (entry, operationId) => entry.isDir
        ? sftpDownloadTree(profileId, entry.path, joinLocal(localPath, entry.name), operationId)
        : sftpDownload(profileId, entry.path, joinLocal(localPath, entry.name), operationId),
      () => loadLocal(localPath),
    );
  }

  return (
    <section className="sftp-dual-browser" aria-label="SFTP 双栏文件管理器">
      <Pane
        entries={remoteEntries}
        isLoading={loadingRemote}
        onEnter={(entry) => entry.isDir && void loadRemote(entry.path)}
        onPathSubmit={() => remoteInput.trim() && void loadRemote(remoteInput.trim())}
        onRefresh={() => remotePath && void loadRemote(remotePath)}
        onSelect={selectRemote}
        onUp={() => void loadRemote(remoteParent(remotePath))}
        path={remoteInput}
        selectedPaths={selectedRemotePaths}
        setPath={setRemoteInput}
        side="remote"
        title="服务器"
        upDisabled={!remotePath || remotePath === "/" || loadingRemote}
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
        entries={localEntries}
        isLoading={loadingLocal}
        onEnter={(entry) => entry.isDir && void loadLocal(entry.path)}
        onPathSubmit={() => localInput.trim() && void loadLocal(localInput.trim())}
        onRefresh={() => localPath && void loadLocal(localPath)}
        onRootSelect={(path) => void loadLocal(path)}
        onSelect={selectLocal}
        onUp={() => void loadLocal(localParent(localPath))}
        path={localInput}
        roots={localRoots}
        selectedPaths={selectedLocalPaths}
        setPath={setLocalInput}
        side="local"
        title="本机"
        upDisabled={!localPath || loadingLocal}
      />
      {error ? <p className="sftp-dual-browser__error">{error}</p> : null}
      {transfer ? (
        <div className="sftp-dual-browser__progress">
          <span>{transfer.direction === "upload" ? "上传" : "下载"} {transfer.name}</span>
          <span>{formatSize(transfer.transferred)}{transfer.total === null ? "" : ` / ${formatSize(transfer.total)}`}</span>
          <div className="sftp-dual-browser__progress-track">
            <div
              className="sftp-dual-browser__progress-value"
              style={{ width: transfer.total ? `${Math.min(100, transfer.transferred / transfer.total * 100)}%` : "45%" }}
            />
          </div>
        </div>
      ) : null}
      {transferSummary ? (
        <p className="sftp-dual-browser__summary">
          传输完成：成功 {transferSummary.completed}，失败 {transferSummary.failed}，共 {transferSummary.total} 项。
        </p>
      ) : null}
      {onOpenInTerminal && remotePath ? (
        <button className="sftp-dual-browser__terminal" onClick={() => onOpenInTerminal(remotePath)} type="button">
          <Icon name="terminalTool" height="14" width="14" />
          <span>在终端中打开服务器目录</span>
        </button>
      ) : null}
    </section>
  );
}

interface PaneProps {
  entries: PaneEntry[];
  isLoading: boolean;
  onEnter: (entry: PaneEntry) => void;
  onPathSubmit: () => void;
  onRefresh: () => void;
  onRootSelect?: (path: string) => void;
  onSelect: (entry: PaneEntry, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onUp: () => void;
  path: string;
  roots?: LocalRoot[];
  selectedPaths: Set<string>;
  setPath: (path: string) => void;
  side: "local" | "remote";
  title: string;
  upDisabled: boolean;
}

function Pane({ entries, isLoading, onEnter, onPathSubmit, onRefresh, onRootSelect, onSelect, onUp, path, roots, selectedPaths, setPath, side, title, upDisabled }: PaneProps) {
  const rootValue = roots?.some((root) => root.path === path) ? path : "";
  return (
    <section className="sftp-dual-browser__pane" aria-label={`${title}文件列表`}>
      <header className="sftp-dual-browser__pane-header">
        <span><Icon name={side === "remote" ? "ssh" : "monitor"} height="15" width="15" />{title}</span>
        <div>
          {selectedPaths.size > 0 ? <span className="sftp-dual-browser__selection-count">已选 {selectedPaths.size}</span> : null}
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
      <div aria-multiselectable="true" className="sftp-dual-browser__list" role="listbox">
        {isLoading ? <p>正在读取…</p> : entries.length === 0 ? <p>此目录为空。</p> : entries.map((entry) => (
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
