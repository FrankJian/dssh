import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  sftpCreateDir,
  sftpCreateFile,
  sftpDeleteEmptyDir,
  sftpDeleteFile,
  sftpDownload,
  sftpDownloadDir,
  sftpHome,
  sftpList,
  sftpRename,
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
  x: number;
  y: number;
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
  const [isMutating, setIsMutating] = useState(false);
  const [inlineAction, setInlineAction] = useState<InlineAction | null>(null);
  const [inlineName, setInlineName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const rootLoadIdRef = useRef(0);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);

  const loadRoot = useCallback(
    async (requestedPath?: string) => {
      const loadId = ++rootLoadIdRef.current;
      const rawPath = requestedPath?.trim();
      setRootError(null);
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
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

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
      if (entry.isDir) {
        await sftpDownloadDir(profileId, entry.path, destination);
      } else {
        await sftpDownload(profileId, entry.path, destination);
      }
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "下载远程文件失败。");
    } finally {
      setIsTransferring(false);
    }
  }

  async function uploadFiles() {
    if (!rootPath || isTransferring) {
      return;
    }
    try {
      const selected = await open({ multiple: true, title: "选择要上传的文件" });
      if (!selected) {
        return;
      }
      const files = Array.isArray(selected) ? selected : [selected];
      setIsTransferring(true);
      setTransferError(null);
      for (const file of files) {
        await sftpUpload(profileId, file, joinRemotePath(rootPath, localBaseName(file)));
      }
      await loadRoot(rootPath);
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "上传文件失败。");
    } finally {
      setIsTransferring(false);
    }
  }

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

  async function confirmDelete() {
    if (!deleteTarget || isMutating) {
      return;
    }
    setIsMutating(true);
    setActionError(null);
    try {
      if (deleteTarget.isDir) {
        await sftpDeleteEmptyDir(profileId, deleteTarget.path);
      } else {
        await sftpDeleteFile(profileId, deleteTarget.path);
        onFileRemoved(deleteTarget.path);
      }
      await refreshDirectory(parentRemotePath(deleteTarget.path));
      setDeleteTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除远程文件失败。");
    } finally {
      setIsMutating(false);
    }
  }

  function openContextMenu(event: React.MouseEvent, entry: SftpEntry) {
    event.preventDefault();
    setContextMenu({ entry, x: event.clientX, y: event.clientY });
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
              onClick={() => onOpenFile(entry)}
              onContextMenu={(event) => openContextMenu(event, entry)}
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
              onClick={() => void toggleDirectory(entry.path)}
              onContextMenu={(event) => openContextMenu(event, entry)}
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

  return (
    <aside className="remote-file-tree" aria-label="远程文件列表">
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
          onClick={() => void uploadFiles()}
          title="上传文件"
          type="button"
        >
          <Icon name="upload" height="15" width="15" />
        </button>
        <button
          aria-label="新建文件夹"
          className="remote-file-tree__refresh"
          disabled={!rootPath || isMutating}
          onClick={() => beginInlineAction({ kind: "createDirectory", parentPath: rootPath })}
          title="新建文件夹"
          type="button"
        >
          <Icon name="folderPlus" height="15" width="15" />
        </button>
        <button
          aria-label="新建文件"
          className="remote-file-tree__refresh"
          disabled={!rootPath || isMutating}
          onClick={() => beginInlineAction({ kind: "createFile", parentPath: rootPath })}
          title="新建文件"
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
      <div className="remote-file-tree__body" role="tree">
        {transferError ? <p className="remote-file-tree__empty remote-file-tree__error">{transferError}</p> : null}
        {actionError ? <p className="remote-file-tree__empty remote-file-tree__error">{actionError}</p> : null}
        {isTransferring ? <p className="remote-file-tree__transfer-status">正在传输文件…</p> : null}
        {renderInlineAction()}
        {root?.entries ? (
          <>
            <button
              aria-expanded={root.expanded}
              className="remote-file-tree__row remote-file-tree__row--root"
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
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
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
            className="context-menu__item context-menu__item--danger"
            disabled={isMutating}
            onClick={() => {
              const entry = contextMenu.entry;
              setContextMenu(null);
              setDeleteTarget(entry);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="trash" height="15" width="15" />
            <span>删除</span>
          </button>
        </div>
      ) : null}
      {deleteTarget ? (
        <div className="remote-file-tree__confirm-backdrop" role="presentation">
          <section
            aria-label="确认删除远程文件"
            aria-modal="true"
            className="remote-file-tree__confirm"
            role="dialog"
          >
            <h2>确认删除？</h2>
            <p>
              {deleteTarget.isDir
                ? `“${deleteTarget.name}”必须为空目录才可删除。`
                : `“${deleteTarget.name}”删除后无法恢复。`}
            </p>
            <div className="remote-file-tree__confirm-actions">
              <button className="button button--ghost" disabled={isMutating} onClick={() => setDeleteTarget(null)} type="button">取消</button>
              <button className="button button--primary" disabled={isMutating} onClick={() => void confirmDelete()} type="button">
                {isMutating ? "正在删除…" : "删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
