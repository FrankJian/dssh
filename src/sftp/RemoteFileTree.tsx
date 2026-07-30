import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  createSftpOperationId,
  onSftpTransferProgress,
  sftpCancelOperation,
  sftpCreateDir,
  sftpCreateFile,
  sftpDeletePreview,
  sftpDeleteRecursive,
  sftpDownload,
  sftpDownloadDir,
  sftpFileInfo,
  sftpHome,
  sftpList,
  sftpMoveEntries,
  sftpRename,
  sftpSetPermissions,
  sftpUpload,
  type SftpEntry,
} from "../services/sftpService";
import { Icon } from "../ui/Icon";

interface RemoteFileTreeProps {
  activeFilePath: string | null;
  onFileRemoved: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onOpenFile: (entry: SftpEntry) => void;
  profileId: string;
  onClose: () => void;
}

interface DirectoryState {
  entries: SftpEntry[] | null;
  error: string | null;
  expanded: boolean;
  loading: boolean;
}

interface InlineAction {
  entry?: SftpEntry;
  kind: "createDirectory" | "createFile" | "rename";
  parentPath: string;
}

interface ExplorerContextMenu {
  entry: SftpEntry;
  maxHeight: number;
  x: number;
  y: number;
}

interface TransferStatus {
  direction: "delete" | "download" | "upload";
  name: string;
  transferred: number;
  total: number | null;
}

interface TransferSummary {
  completed: number;
  failed: number;
  total: number;
}

interface PointerDragState {
  active: boolean;
  name: string;
  pointerId: number;
  startX: number;
  startY: number;
}

interface PointerDragPreview {
  count: number;
  name: string;
  x: number;
  y: number;
}

interface DeleteConfirmation {
  entries: SftpEntry[];
  files: number;
  directories: number;
  symlinks: number;
  paths: string[];
  truncated: boolean;
}

function pathName(path: string): string {
  if (path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || "/";
}

function fileIcon(entry: SftpEntry) {
  const extension = entry.name.split(".").pop()?.toLowerCase();
  if (["js", "ts", "tsx", "jsx", "rs", "py", "go", "java", "c", "h", "cpp"].includes(extension ?? "")) {
    return "fileCode" as const;
  }
  if (["md", "txt", "log", "yaml", "yml", "json", "toml", "xml"].includes(extension ?? "")) {
    return "fileText" as const;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(extension ?? "")) {
    return "fileImage" as const;
  }
  return "file" as const;
}

function localBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

function joinRemotePath(directory: string, name: string): string {
  return directory === "/" ? `/${name}` : `${directory.replace(/\/+$/, "")}/${name}`;
}

function parentRemotePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const separator = trimmed.lastIndexOf("/");
  if (separator <= 0) {
    return "/";
  }
  return trimmed.slice(0, separator);
}

function isNestedRemotePath(path: string, parent: string): boolean {
  return path.startsWith(`${parent.replace(/\/+$/, "")}/`);
}

function validEntryName(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed && ![".", ".."].includes(trimmed) && !/[\\/\0]/.test(trimmed));
}

/**
 * Compact, lazy remote directory tree used beside an active SSH terminal. It
 * deliberately reuses the existing SFTP service, so it retains the same TOFU
 * host-key validation and one-per-host SFTP connection behaviour as FileBrowser.
 */
export function RemoteFileTree({
  activeFilePath,
  onFileRemoved,
  onFileRenamed,
  onOpenFile,
  profileId,
  onClose,
}: RemoteFileTreeProps) {
  const [rootPath, setRootPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState<TransferStatus | null>(null);
  const [transferSummary, setTransferSummary] = useState<TransferSummary | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [remoteDropTargetPath, setRemoteDropTargetPath] = useState<string | null>(null);
  const [pointerDragPreview, setPointerDragPreview] = useState<PointerDragPreview | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [inlineAction, setInlineAction] = useState<InlineAction | null>(null);
  const [inlineName, setInlineName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenu | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [propertiesEntry, setPropertiesEntry] = useState<SftpEntry | null>(null);
  const rootLoadIdRef = useRef(0);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const treeBodyRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const transferOperationIdRef = useRef<string | null>(null);
  const remoteDragPathsRef = useRef<string[] | null>(null);
  const remoteDropTargetRef = useRef<string | null>(null);
  const nativeDropTargetRef = useRef<string | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const suppressClickRef = useRef(false);
  const nativeCoordinateScaleRef = useRef({ x: 1, y: 1 });
  const transferStateRef = useRef({ isTransferring, profileId, rootPath });
  transferStateRef.current = { isTransferring, profileId, rootPath };

  const loadRoot = useCallback(
    async (requestedPath?: string) => {
      const loadId = ++rootLoadIdRef.current;
      const rawPath = requestedPath?.trim();
      setRootError(null);
      setActionError(null);
      setDirectories({});
      try {
        const target = rawPath || (await sftpHome(profileId));
        const listing = await sftpList(profileId, target);
        if (loadId !== rootLoadIdRef.current) {
          return;
        }
        setRootPath(listing.path);
        setPathInput(listing.path);
        setDirectories({
          [listing.path]: {
            entries: listing.entries,
            error: null,
            expanded: true,
            loading: false,
          },
        });
      } catch (error) {
        if (loadId !== rootLoadIdRef.current) {
          return;
        }
        setRootPath("");
        setRootError(error instanceof Error ? error.message : "读取远程目录失败。");
      }
    },
    [profileId],
  );

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  useEffect(() => {
    if (!actionError) {
      return;
    }
    const timeout = window.setTimeout(() => setActionError(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [actionError]);

  useEffect(() => {
    inlineInputRef.current?.focus();
    inlineInputRef.current?.select();
  }, [inlineAction]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    treeBodyRef.current?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
      treeBodyRef.current?.removeEventListener("scroll", close);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      return;
    }
    const menu = contextMenuRef.current.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    const margin = 8;
    const left = panel?.left ?? 0;
    const top = panel?.top ?? 0;
    const right = panel?.right ?? window.innerWidth;
    const bottom = panel?.bottom ?? window.innerHeight;
    const x = Math.max(left + margin, Math.min(contextMenu.x, right - menu.width - margin));
    const y = Math.max(top + margin, Math.min(contextMenu.y, bottom - menu.height - margin));
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((current) => current ? { ...current, x, y } : null);
    }
  }, [contextMenu]);

  useEffect(() => {
    const unlisten = onSftpTransferProgress((progress) => {
      if (
        progress.profileId !== profileId
        || progress.operationId !== transferOperationIdRef.current
      ) {
        return;
      }
      setTransferStatus((current) => current
        ? {
            ...current,
            transferred: progress.transferred,
            total: progress.total ?? current.total,
          }
        : current);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [profileId]);

  const refreshDirectory = useCallback(
    async (path: string) => {
      if (path === rootPath) {
        await loadRoot(path);
        return;
      }
      const listing = await sftpList(profileId, path);
      setDirectories((items) => ({
        ...items,
        [listing.path]: {
          entries: listing.entries,
          error: null,
          expanded: items[listing.path]?.expanded ?? true,
          loading: false,
        },
      }));
    },
    [loadRoot, profileId, rootPath],
  );

  const toggleDirectory = useCallback(
    async (path: string) => {
      const current = directories[path];
      if (current?.loading) {
        return;
      }
      if (current?.entries) {
        setDirectories((items) => ({
          ...items,
          [path]: { ...items[path], expanded: !items[path].expanded },
        }));
        return;
      }

      setDirectories((items) => ({
        ...items,
        [path]: { entries: null, error: null, expanded: true, loading: true },
      }));
      try {
        const listing = await sftpList(profileId, path);
        setDirectories((items) => ({
          ...items,
          [path]: { entries: listing.entries, error: null, expanded: true, loading: false },
        }));
      } catch (error) {
        setDirectories((items) => ({
          ...items,
          [path]: {
            entries: null,
            error: error instanceof Error ? error.message : "读取目录失败。",
            expanded: true,
            loading: false,
          },
        }));
      }
    },
    [directories, profileId],
  );

  function visibleEntries(): SftpEntry[] {
    const entries: SftpEntry[] = [];
    const append = (path: string) => {
      const directory = directories[path];
      if (!directory?.expanded || !directory.entries) {
        return;
      }
      for (const entry of directory.entries) {
        entries.push(entry);
        if (entry.isDir) {
          append(entry.path);
        }
      }
    };
    if (rootPath) {
      append(rootPath);
    }
    return entries;
  }

  function selectEntry(event: React.MouseEvent, entry: SftpEntry) {
    const paths = visibleEntries().map((item) => item.path);
    const isToggle = event.metaKey || event.ctrlKey;
    if (event.shiftKey && selectionAnchor) {
      const first = paths.indexOf(selectionAnchor);
      const last = paths.indexOf(entry.path);
      if (first >= 0 && last >= 0) {
        const range = paths.slice(Math.min(first, last), Math.max(first, last) + 1);
        setSelectedPaths(new Set(range));
        return;
      }
    }
    if (isToggle) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      });
    } else {
      setSelectedPaths(new Set([entry.path]));
    }
    setSelectionAnchor(entry.path);
  }

  function selectedEntries() {
    const byPath = new Map(visibleEntries().map((entry) => [entry.path, entry]));
    return [...selectedPaths].flatMap((path) => {
      const entry = byPath.get(path);
      return entry ? [entry] : [];
    });
  }

  function selectedDirectoryPath() {
    const entries = selectedEntries();
    return entries.length === 1 && entries[0].isDir ? entries[0].path : rootPath;
  }

  async function downloadEntry(entry: SftpEntry) {
    if (isTransferring) {
      return;
    }
    try {
      const destination = entry.isDir
        ? await save({
            defaultPath: `${entry.name}.tar.gz`,
            filters: [{ extensions: ["tar.gz", "tgz"], name: "Gzip 压缩包" }],
          })
        : await save({ defaultPath: entry.name });
      if (!destination) {
        return;
      }
      setIsTransferring(true);
      setTransferError(null);
      setTransferSummary(null);
      const operationId = createSftpOperationId("download");
      transferOperationIdRef.current = operationId;
      setTransferStatus({
        direction: "download",
        name: entry.isDir ? `${entry.name}.tar.gz` : entry.name,
        transferred: 0,
        total: null,
      });
      if (entry.isDir) {
        await sftpDownloadDir(profileId, entry.path, destination, operationId);
      } else {
        await sftpDownload(profileId, entry.path, destination, operationId);
      }
      setTransferSummary({ completed: 1, failed: 0, total: 1 });
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "下载远程文件失败。");
    } finally {
      transferOperationIdRef.current = null;
      setTransferStatus(null);
      setIsTransferring(false);
    }
  }

  const uploadFiles = useCallback(async (files: string[], targetDirectory: string) => {
    if (!targetDirectory || files.length === 0 || transferStateRef.current.isTransferring) {
      return;
    }
    setIsTransferring(true);
    setTransferError(null);
    setTransferSummary(null);
    let completed = 0;
    let failed = 0;
    let firstError: string | null = null;
    try {
      for (const file of files) {
        const operationId = createSftpOperationId("upload");
        transferOperationIdRef.current = operationId;
        setTransferStatus({
          direction: "upload",
          name: localBaseName(file),
          transferred: 0,
          total: null,
        });
        try {
          await sftpUpload(profileId, file, joinRemotePath(targetDirectory, localBaseName(file)), operationId);
          completed += 1;
        } catch (error) {
          failed += 1;
          firstError ??= error instanceof Error ? error.message : "上传文件失败。";
        }
      }
      if (firstError) {
        setTransferError(firstError);
      }
      try {
        await refreshDirectory(targetDirectory);
      } catch (error) {
        setTransferError(error instanceof Error ? error.message : "上传完成后刷新目录失败。");
      }
    } finally {
      transferOperationIdRef.current = null;
      setTransferStatus(null);
      setTransferSummary({ completed, failed, total: files.length });
      setIsTransferring(false);
    }
  }, [profileId, refreshDirectory]);

  async function selectAndUploadFiles() {
    if (!rootPath || isTransferring) {
      return;
    }
    const selected = await open({ multiple: true, title: "选择要上传的文件" });
    if (!selected) {
      return;
    }
    await uploadFiles(Array.isArray(selected) ? selected : [selected], rootPath);
  }

  function directoryAtClientPoint(clientX: number, clientY: number): string | null {
    const body = treeBodyRef.current;
    if (!body) {
      return null;
    }
    const bounds = body.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
      return null;
    }
    const directory = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-remote-directory]");
    if (directory && body.contains(directory)) {
      return directory.dataset.remoteDirectory ?? rootPath;
    }
    return rootPath || null;
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    function targetDirectory(position: { x: number; y: number }) {
      const scale = nativeCoordinateScaleRef.current;
      return directoryAtClientPoint(position.x / scale.x, position.y / scale.y);
    }

    async function updateCoordinateScale() {
      const size = await getCurrentWindow().innerSize();
      nativeCoordinateScaleRef.current = {
        x: size.width / Math.max(window.innerWidth, 1),
        y: size.height / Math.max(window.innerHeight, 1),
      };
    }

    void updateCoordinateScale();
    window.addEventListener("resize", updateCoordinateScale);

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          const target = targetDirectory(payload.position);
          nativeDropTargetRef.current = target;
          setIsDragOver(Boolean(target));
          setDropTargetPath(target);
          return;
        }
        if (payload.type === "leave") {
          nativeDropTargetRef.current = null;
          setIsDragOver(false);
          setDropTargetPath(null);
          return;
        }
        if (payload.type === "drop") {
          const target = targetDirectory(payload.position) ?? nativeDropTargetRef.current;
          nativeDropTargetRef.current = null;
          setIsDragOver(false);
          setDropTargetPath(null);
          if (
            target
            && payload.paths.length > 0
            && !transferStateRef.current.isTransferring
          ) {
            void uploadFiles(payload.paths, target);
          }
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      disposed = true;
      window.removeEventListener("resize", updateCoordinateScale);
      unlisten?.();
    };
  }, [rootPath, uploadFiles]);

  function beginInlineAction(action: InlineAction) {
    setContextMenu(null);
    setActionError(null);
    setInlineAction(action);
    setInlineName(action.kind === "rename" ? action.entry?.name ?? "" : "");
  }

  async function submitInlineAction() {
    if (!inlineAction || isMutating) {
      return;
    }
    const name = inlineName.trim();
    if (!validEntryName(name)) {
      setActionError("名称不能为空，且不能包含路径分隔符。");
      return;
    }

    setIsMutating(true);
    setActionError(null);
    try {
      if (inlineAction.kind === "createDirectory") {
        await sftpCreateDir(profileId, inlineAction.parentPath, name);
      } else if (inlineAction.kind === "createFile") {
        const path = await sftpCreateFile(profileId, inlineAction.parentPath, name);
        onOpenFile({
          isDir: false,
          isSymlink: false,
          modified: null,
          name,
          path,
          size: 0,
        });
      } else if (inlineAction.entry) {
        const path = await sftpRename(profileId, inlineAction.entry.path, name);
        onFileRenamed(inlineAction.entry.path, path);
      }
      await refreshDirectory(inlineAction.parentPath);
      setInlineAction(null);
      setInlineName("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "远程文件操作失败。");
    } finally {
      setIsMutating(false);
    }
  }

  async function requestDelete(entries: SftpEntry[]) {
    if (entries.length === 0 || isMutating) {
      return;
    }
    setIsMutating(true);
    setActionError(null);
    try {
      const previews = await Promise.all(entries.map((entry) => sftpDeletePreview(profileId, entry.path)));
      setDeleteConfirmation({
        entries,
        files: previews.reduce((total, preview) => total + preview.files, 0),
        directories: previews.reduce((total, preview) => total + preview.directories, 0),
        symlinks: previews.reduce((total, preview) => total + preview.symlinks, 0),
        paths: previews.flatMap((preview) => preview.paths).slice(0, 100),
        truncated: previews.some((preview) => preview.truncated) || previews.flatMap((preview) => preview.paths).length > 100,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "无法预览删除范围。");
    } finally {
      setIsMutating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirmation || isMutating) {
      return;
    }
    setIsMutating(true);
    setActionError(null);
    let deleted = 0;
    let failed = 0;
    try {
      for (const entry of deleteConfirmation.entries) {
        const operationId = createSftpOperationId("delete");
        transferOperationIdRef.current = operationId;
        setTransferStatus({ direction: "delete", name: entry.name, transferred: 0, total: null });
        try {
          const result = await sftpDeleteRecursive(profileId, entry.path, operationId);
          deleted += result.deleted;
          if (result.cancelled) {
            setActionError("删除已取消，未处理的项目将保留。");
            break;
          }
          onFileRemoved(entry.path);
        } catch (error) {
          failed += 1;
          setActionError(error instanceof Error ? error.message : "删除远程文件失败。");
        }
      }
    } finally {
      transferOperationIdRef.current = null;
      setTransferStatus(null);
      setTransferSummary({ completed: deleted, failed, total: deleteConfirmation.entries.length });
      setSelectedPaths(new Set());
      setDeleteConfirmation(null);
      await loadRoot(rootPath);
      setIsMutating(false);
    }
  }

  async function moveSelectedEntries(targetDirectory: string, paths = remoteDragPathsRef.current ?? []) {
    const visibleByPath = new Map(visibleEntries().map((entry) => [entry.path, entry]));
    const entries = paths
      .flatMap((path) => {
        const entry = visibleByPath.get(path);
        return entry ? [entry] : [];
      })
      .filter((entry, _index, all) =>
      !all.some((other) => other.path !== entry.path && isNestedRemotePath(entry.path, other.path)),
    );
    if (entries.length === 0 || entries.every((entry) => entry.path === targetDirectory) || isMutating) {
      return;
    }
    setIsMutating(true);
    setActionError(null);
    try {
      const destinations = await sftpMoveEntries(profileId, entries.map((entry) => entry.path), targetDirectory);
      entries.forEach((entry, index) => {
        const destination = destinations[index];
        if (destination) {
          onFileRenamed(entry.path, destination);
        }
      });
      setSelectedPaths(new Set(destinations));
      await loadRoot(rootPath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "移动远程文件失败。");
    } finally {
      remoteDragPathsRef.current = null;
      setIsMutating(false);
    }
  }

  function canMoveTo(targetDirectory: string, paths: string[]) {
    if (!targetDirectory || paths.length === 0) {
      return false;
    }
    return paths.every((path) =>
      path !== targetDirectory && !isNestedRemotePath(targetDirectory, path),
    );
  }

  function openContextMenu(event: React.MouseEvent, entry: SftpEntry) {
    event.preventDefault();
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setSelectionAnchor(entry.path);
    }
    const panelHeight = panelRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    setContextMenu({ entry, maxHeight: Math.max(80, panelHeight - 16), x: event.clientX, y: event.clientY });
  }

  function setDirectoryAsRoot(path: string) {
    setContextMenu(null);
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setInlineAction(null);
    void loadRoot(path);
  }

  function beginPointerDrag(event: React.PointerEvent, entry: SftpEntry) {
    if (event.button !== 0 || isMutating) {
      return;
    }
    setActionError(null);
    const paths = selectedPaths.has(entry.path) ? [...selectedPaths] : [entry.path];
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set(paths));
      setSelectionAnchor(entry.path);
    }
    remoteDragPathsRef.current = paths;
    remoteDropTargetRef.current = null;
    setRemoteDropTargetPath(null);
    pointerDragRef.current = {
      active: false,
      name: entry.name,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  useEffect(() => {
    function clearPointerDrag() {
      pointerDragRef.current = null;
      remoteDragPathsRef.current = null;
      remoteDropTargetRef.current = null;
      setRemoteDropTargetPath(null);
      setPointerDragPreview(null);
    }

    function onPointerMove(event: PointerEvent) {
      const drag = pointerDragRef.current;
      const paths = remoteDragPathsRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !paths?.length) {
        return;
      }
      if (!drag.active) {
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (distance < 5) {
          return;
        }
        drag.active = true;
        suppressClickRef.current = true;
      }
      event.preventDefault();
      const target = directoryAtClientPoint(event.clientX, event.clientY);
      if (!target || !canMoveTo(target, paths)) {
        remoteDropTargetRef.current = null;
        setRemoteDropTargetPath(null);
      } else {
        remoteDropTargetRef.current = target;
        setRemoteDropTargetPath(target);
      }
      setPointerDragPreview({
        count: paths.length,
        name: drag.name,
        x: event.clientX + 12,
        y: event.clientY + 12,
      });
    }

    function onPointerUp(event: PointerEvent) {
      const drag = pointerDragRef.current;
      const paths = remoteDragPathsRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const target = remoteDropTargetRef.current;
      const shouldMove = drag.active && paths?.length && target && canMoveTo(target, paths);
      clearPointerDrag();
      if (shouldMove) {
        void moveSelectedEntries(target, paths);
      }
    }

    function onPointerCancel(event: PointerEvent) {
      if (pointerDragRef.current?.pointerId === event.pointerId) {
        clearPointerDrag();
      }
    }

    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [directories, isMutating, rootPath]);

  function consumeSuppressedClick(event: React.MouseEvent) {
    if (!suppressClickRef.current) {
      return false;
    }
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function renderInlineAction() {
    if (!inlineAction) {
      return null;
    }
    const actionLabel =
      inlineAction.kind === "rename"
        ? "重命名"
        : inlineAction.kind === "createDirectory"
          ? "新建文件夹"
          : "新建文件";
    return (
      <form
        className="remote-file-tree__inline-action"
        onSubmit={(event) => {
          event.preventDefault();
          void submitInlineAction();
        }}
      >
        <span className="remote-file-tree__inline-label">{actionLabel}</span>
        <input
          aria-label={`${actionLabel}名称`}
          disabled={isMutating}
          onChange={(event) => setInlineName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setInlineAction(null);
              setInlineName("");
              setActionError(null);
            }
          }}
          ref={inlineInputRef}
          value={inlineName}
        />
        <button className="remote-file-tree__inline-save" disabled={isMutating} type="submit">确定</button>
        <button
          className="remote-file-tree__inline-cancel"
          disabled={isMutating}
          onClick={() => {
            setInlineAction(null);
            setInlineName("");
            setActionError(null);
          }}
          type="button"
        >
          取消
        </button>
      </form>
    );
  }

  function renderEntries(entries: SftpEntry[], depth: number) {
    return entries.map((entry) => {
      if (!entry.isDir) {
        return (
          <div className="remote-file-tree__entry" key={entry.path}>
            <button
              aria-current={entry.path === activeFilePath ? "page" : undefined}
              className="remote-file-tree__row remote-file-tree__row--file"
              data-active={entry.path === activeFilePath}
              data-selected={selectedPaths.has(entry.path)}
              onClick={(event) => {
                if (consumeSuppressedClick(event)) {
                  return;
                }
                selectEntry(event, entry);
                if (!event.metaKey && !event.ctrlKey) {
                  onOpenFile(entry);
                }
              }}
              onContextMenu={(event) => openContextMenu(event, entry)}
              onPointerDown={(event) => beginPointerDrag(event, entry)}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              title={entry.path}
              type="button"
            >
              <span className="remote-file-tree__indent" />
              <Icon name={fileIcon(entry)} height="15" width="15" />
              <span className="remote-file-tree__name" title={entry.name}>{entry.name}</span>
            </button>
            <button
              aria-label={`下载 ${entry.name}`}
              className="remote-file-tree__transfer"
              disabled={isTransferring}
              onClick={() => void downloadEntry(entry)}
              title="下载"
              type="button"
            >
              <Icon name="download" height="14" width="14" />
            </button>
          </div>
        );
      }

      const state = directories[entry.path];
      const expanded = state?.expanded ?? false;
      return (
        <div className="remote-file-tree__branch" key={entry.path}>
          <div className="remote-file-tree__entry">
            <button
              aria-expanded={expanded}
              className="remote-file-tree__row remote-file-tree__row--directory"
              data-remote-directory={entry.path}
              data-remote-drop-target={(remoteDropTargetPath ?? dropTargetPath) === entry.path}
              data-selected={selectedPaths.has(entry.path)}
              onClick={(event) => {
                if (consumeSuppressedClick(event)) {
                  return;
                }
                selectEntry(event, entry);
                void toggleDirectory(entry.path);
              }}
              onContextMenu={(event) => openContextMenu(event, entry)}
              onPointerDown={(event) => beginPointerDrag(event, entry)}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              title={entry.path}
              type="button"
            >
              <span className="remote-file-tree__chevron" data-expanded={expanded}>
                <Icon name="chevron-right" height="14" width="14" />
              </span>
              <Icon name="folder" height="15" width="15" />
              <span className="remote-file-tree__name">{entry.name}</span>
              {state?.loading ? <span className="remote-file-tree__loading">…</span> : null}
            </button>
            <button
              aria-label={`打包下载 ${entry.name}`}
              className="remote-file-tree__transfer"
              disabled={isTransferring}
              onClick={() => void downloadEntry(entry)}
              title="打包下载"
              type="button"
            >
              <Icon name="download" height="14" width="14" />
            </button>
          </div>
          {expanded && state?.entries ? renderEntries(state.entries, depth + 1) : null}
          {expanded && state?.error ? <p className="remote-file-tree__error">{state.error}</p> : null}
        </div>
      );
    });
  }

  const root = rootPath ? directories[rootPath] : null;
  const creationParentPath = selectedDirectoryPath();
  const isCreatingInSelectedDirectory = creationParentPath !== rootPath;

  return (
    <aside
      aria-label="远程文件列表"
      className={`remote-file-tree${isDragOver ? " is-drag-over" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      ref={panelRef}
    >
      {isDragOver ? (
        <div className="remote-file-tree__dropzone">
          松开鼠标上传到 {dropTargetPath === rootPath ? "当前根目录" : pathName(dropTargetPath ?? "")}
        </div>
      ) : null}
      {pointerDragPreview ? (
        <div
          className="remote-file-tree__drag-preview"
          style={{ left: pointerDragPreview.x, top: pointerDragPreview.y }}
        >
          <Icon name="file" height="14" width="14" />
          <span>{pointerDragPreview.name}</span>
          {pointerDragPreview.count > 1 ? <strong>{pointerDragPreview.count}</strong> : null}
        </div>
      ) : null}
      <div className="remote-file-tree__toolbar">
        <label className="remote-file-tree__path">
          <Icon name="folder" height="15" width="15" />
          <input
            aria-label="文件列表根目录"
            onChange={(event) => setPathInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loadRoot(pathInput);
              }
            }}
            placeholder="输入远程路径后按 Enter"
            value={pathInput}
          />
        </label>
        <button
          aria-label="刷新文件列表"
          className="remote-file-tree__refresh"
          onClick={() => void loadRoot(pathInput)}
          title="刷新"
          type="button"
        >
          <Icon name="refresh" height="15" width="15" />
        </button>
        <button
          aria-label="上传文件到当前根目录"
          className="remote-file-tree__refresh"
          disabled={!rootPath || isTransferring}
          onClick={() => void selectAndUploadFiles()}
          title="上传文件"
          type="button"
        >
          <Icon name="upload" height="15" width="15" />
        </button>
        <button
          aria-label={isCreatingInSelectedDirectory ? "在选中文件夹中新建文件夹" : "新建文件夹"}
          className="remote-file-tree__refresh"
          disabled={!rootPath || isMutating}
          onClick={() => beginInlineAction({ kind: "createDirectory", parentPath: creationParentPath })}
          title={isCreatingInSelectedDirectory ? `在 ${pathName(creationParentPath)} 中新建文件夹` : "新建文件夹"}
          type="button"
        >
          <Icon name="folderPlus" height="15" width="15" />
        </button>
        <button
          aria-label={isCreatingInSelectedDirectory ? "在选中文件夹中新建文件" : "新建文件"}
          className="remote-file-tree__refresh"
          disabled={!rootPath || isMutating}
          onClick={() => beginInlineAction({ kind: "createFile", parentPath: creationParentPath })}
          title={isCreatingInSelectedDirectory ? `在 ${pathName(creationParentPath)} 中新建文件` : "新建文件"}
          type="button"
        >
          <Icon name="file" height="15" width="15" />
        </button>
        <button
          aria-label="关闭文件列表"
          className="remote-file-tree__refresh"
          onClick={onClose}
          title="关闭文件列表"
          type="button"
        >
          <Icon name="close" height="15" width="15" />
        </button>
      </div>
      {selectedPaths.size > 0 ? (
        <div className="remote-file-tree__selection-toolbar">
          <span>已选 {selectedPaths.size} 项</span>
          <button
            disabled={isTransferring || isMutating}
            onClick={() => {
              const entries = selectedEntries();
              void (async () => {
                for (const entry of entries) {
                  await downloadEntry(entry);
                }
              })();
            }}
            type="button"
          >
            下载
          </button>
          <button
            disabled={isMutating}
            onClick={() => void requestDelete(selectedEntries())}
            type="button"
          >
            删除
          </button>
          <button onClick={() => setSelectedPaths(new Set())} type="button">取消选择</button>
        </div>
      ) : null}
      <div className="remote-file-tree__body" ref={treeBodyRef} role="tree">
        {transferError ? <p className="remote-file-tree__empty remote-file-tree__error">{transferError}</p> : null}
        {actionError ? <p className="remote-file-tree__empty remote-file-tree__error">{actionError}</p> : null}
        {transferStatus ? (
          <div className="remote-file-tree__transfer-status">
            <span>
              {transferStatus.direction === "upload"
                ? "正在上传"
                : transferStatus.direction === "delete"
                  ? "正在删除"
                  : "正在下载"}
              ：{transferStatus.name}
            </span>
            <span>
              {formatSize(transferStatus.transferred)}
              {transferStatus.total === null ? "" : ` / ${formatSize(transferStatus.total)}`}
            </span>
            {transferStatus.total !== null && transferStatus.total > 0 ? (
              <div className="remote-file-tree__progress-track" aria-hidden="true">
                <div
                  className="remote-file-tree__progress-value"
                  style={{ width: `${Math.min(100, (transferStatus.transferred / transferStatus.total) * 100)}%` }}
                />
              </div>
            ) : null}
            {transferStatus.direction === "delete" && transferOperationIdRef.current ? (
              <button
                className="remote-file-tree__cancel-operation"
                onClick={() => void sftpCancelOperation(transferOperationIdRef.current!)}
                type="button"
              >
                取消删除
              </button>
            ) : null}
          </div>
        ) : null}
        {transferSummary ? (
          <p className="remote-file-tree__transfer-summary">
            {transferSummary.failed > 0
              ? `传输完成：${transferSummary.completed}/${transferSummary.total} 成功，${transferSummary.failed} 失败。`
              : `传输完成：${transferSummary.completed}/${transferSummary.total}。`}
          </p>
        ) : null}
        {renderInlineAction()}
        {root?.entries ? (
          <>
            <button
              aria-expanded={root.expanded}
              className="remote-file-tree__row remote-file-tree__row--root"
              data-remote-directory={rootPath}
              data-remote-drop-target={(remoteDropTargetPath ?? dropTargetPath) === rootPath}
              onClick={() => void toggleDirectory(rootPath)}
              title={rootPath}
              type="button"
            >
              <span className="remote-file-tree__chevron" data-expanded={root.expanded}>
                <Icon name="chevron-right" height="14" width="14" />
              </span>
              <Icon name="folder" height="15" width="15" />
              <span className="remote-file-tree__name">{pathName(rootPath)}</span>
            </button>
            {root.expanded ? renderEntries(root.entries, 1) : null}
          </>
        ) : rootError ? (
          <p className="remote-file-tree__empty remote-file-tree__error">{rootError}</p>
        ) : (
          <p className="remote-file-tree__empty">正在读取文件列表…</p>
        )}
      </div>
      {contextMenu ? (
        <div
          className="context-menu"
          ref={contextMenuRef}
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, maxHeight: `${contextMenu.maxHeight}px`, top: contextMenu.y }}
        >
          {!contextMenu.entry.isDir ? (
            <button
              className="context-menu__item"
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                onOpenFile(entry);
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="edit" height="15" width="15" />
              <span>打开</span>
            </button>
          ) : null}
          {contextMenu.entry.isDir ? (
            <>
              <button
                className="context-menu__item"
                onClick={() => setDirectoryAsRoot(contextMenu.entry.path)}
                role="menuitem"
                type="button"
              >
                <Icon name="folder" height="15" width="15" />
                <span>设为根目录</span>
              </button>
              <button
                className="context-menu__item"
                onClick={() => beginInlineAction({
                  kind: "createFile",
                  parentPath: contextMenu.entry.path,
                })}
                role="menuitem"
                type="button"
              >
                <Icon name="file" height="15" width="15" />
                <span>新建文件</span>
              </button>
              <button
                className="context-menu__item"
                onClick={() => beginInlineAction({
                  kind: "createDirectory",
                  parentPath: contextMenu.entry.path,
                })}
                role="menuitem"
                type="button"
              >
                <Icon name="folderPlus" height="15" width="15" />
                <span>新建文件夹</span>
              </button>
            </>
          ) : null}
          <button
            className="context-menu__item"
            disabled={isTransferring}
            onClick={() => {
              const entry = contextMenu.entry;
              setContextMenu(null);
              void downloadEntry(entry);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="download" height="15" width="15" />
            <span>{contextMenu.entry.isDir ? "打包下载" : "下载"}</span>
          </button>
          <button
            className="context-menu__item"
            disabled={isMutating}
            onClick={() => beginInlineAction({
              entry: contextMenu.entry,
              kind: "rename",
              parentPath: parentRemotePath(contextMenu.entry.path),
            })}
            role="menuitem"
            type="button"
          >
            <Icon name="edit" height="15" width="15" />
            <span>重命名</span>
          </button>
          <button
            className="context-menu__item"
            onClick={() => {
              setPropertiesEntry(contextMenu.entry);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="info" height="15" width="15" />
            <span>属性</span>
          </button>
          <button
            className="context-menu__item context-menu__item--danger"
            disabled={isMutating}
            onClick={() => {
              const entry = contextMenu.entry;
              setContextMenu(null);
              void requestDelete([entry]);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="trash" height="15" width="15" />
            <span>删除</span>
          </button>
        </div>
      ) : null}
      {deleteConfirmation ? (
        <div className="remote-file-tree__confirm-backdrop" role="presentation">
          <section
            aria-label="确认删除远程文件"
            aria-modal="true"
            className="remote-file-tree__confirm"
            role="dialog"
          >
            <h2>确认删除？</h2>
            <p>
              将删除 {deleteConfirmation.files} 个文件、{deleteConfirmation.directories} 个目录和 {deleteConfirmation.symlinks} 个符号链接。此操作无法恢复。
            </p>
            {deleteConfirmation.paths.length > 0 ? (
              <p className="remote-file-tree__delete-preview">
                {deleteConfirmation.paths.slice(0, 5).join("\n")}
                {deleteConfirmation.truncated ? "\n…" : ""}
              </p>
            ) : null}
            <div className="remote-file-tree__confirm-actions">
              <button className="button button--ghost" disabled={isMutating} onClick={() => setDeleteConfirmation(null)} type="button">取消</button>
              <button className="button button--primary" disabled={isMutating} onClick={() => void confirmDelete()} type="button">
                {isMutating ? "正在删除…" : "删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {propertiesEntry ? (
        <FilePropertiesDialog
          entry={propertiesEntry}
          onClose={() => setPropertiesEntry(null)}
          onSaved={() => void refreshDirectory(parentRemotePath(propertiesEntry.path))}
          profileId={profileId}
        />
      ) : null}
    </aside>
  );
}

interface FilePropertiesDialogProps {
  entry: SftpEntry;
  onClose: () => void;
  onSaved: () => void;
  profileId: string;
}

function FilePropertiesDialog({ entry, onClose, onSaved, profileId }: FilePropertiesDialogProps) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof sftpFileInfo>> | null>(null);
  const [permissions, setPermissions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setError(null);
    void sftpFileInfo(profileId, entry.path)
      .then((value) => {
        if (!cancelled) {
          setInfo(value);
          setPermissions(value.permissions === null ? "" : (value.permissions & 0o7777).toString(8));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "无法读取文件属性。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path, profileId]);

  async function savePermissions() {
    if (!/^[0-7]{3,4}$/.test(permissions)) {
      setError("请输入 3 或 4 位八进制权限，例如 644 或 0755。");
      return;
    }
    if (!window.confirm(`确认将“${entry.name}”的权限修改为 ${permissions}？`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sftpSetPermissions(profileId, entry.path, Number.parseInt(permissions, 8));
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改权限失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="remote-file-tree__confirm-backdrop" role="presentation">
      <section aria-label="远程文件属性" aria-modal="true" className="remote-file-tree__confirm" role="dialog">
        <h2>属性</h2>
        {error ? <p className="remote-file-tree__error">{error}</p> : null}
        {info ? (
          <div className="remote-file-tree__properties">
            <p>路径：{info.path}</p>
            <p>类型：{info.isSymlink ? "符号链接" : info.isDir ? "目录" : "文件"}</p>
            <p>大小：{formatSize(info.size)}</p>
            <p>修改时间：{info.modified === null ? "不可用" : new Date(info.modified * 1000).toLocaleString()}</p>
            <p>属主：{info.user ?? "不可用"}{info.group ? ` / ${info.group}` : ""}</p>
            <label>
              权限（八进制）
              <input
                aria-label="八进制权限"
                disabled={saving || info.permissions === null}
                onChange={(event) => setPermissions(event.currentTarget.value)}
                value={permissions}
              />
            </label>
            {info.permissions === null ? <p>此服务器未返回 POSIX 权限。</p> : null}
          </div>
        ) : !error ? <p>正在读取属性…</p> : null}
        <div className="remote-file-tree__confirm-actions">
          <button className="button button--ghost" disabled={saving} onClick={onClose} type="button">关闭</button>
          <button
            className="button button--primary"
            disabled={saving || !info || info.permissions === null}
            onClick={() => void savePermissions()}
            type="button"
          >
            {saving ? "正在保存…" : "保存权限"}
          </button>
        </div>
      </section>
    </div>
  );
}
