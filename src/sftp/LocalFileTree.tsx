import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from "react";
import {
  sftpLocalCreateDir,
  sftpLocalCreateFile,
  sftpLocalDelete,
  sftpLocalHome,
  sftpLocalList,
  sftpLocalRename,
  sftpLocalRoots,
  type LocalFileEntry,
  type LocalRoot,
} from "../services/sftpService";
import { Icon } from "../ui/Icon";
import { SelectMenu } from "../ui/SelectMenu";

interface LocalFileTreeProps {
  activeFilePath: string | null;
  onClose: () => void;
  onFileRemoved?: (path: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
  onOpenFile: (entry: LocalFileEntry) => void;
}

interface DirectoryState {
  entries: LocalFileEntry[] | null;
  error: string | null;
  expanded: boolean;
  loading: boolean;
}

interface ContextMenu {
  entry: LocalFileEntry;
  x: number;
  y: number;
}

function pathName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

function fileIcon(entry: LocalFileEntry) {
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

/** Local counterpart of RemoteFileTree. It intentionally has no transfer or
 * drag/drop actions: the local terminal only needs browsing and editing. */
export function LocalFileTree({
  activeFilePath,
  onClose,
  onFileRemoved,
  onFileRenamed,
  onOpenFile,
}: LocalFileTreeProps) {
  const [rootPath, setRootPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [roots, setRoots] = useState<LocalRoot[]>([]);
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const loadRoot = useCallback(async (requestedPath?: string) => {
    setRootError(null);
    setDirectories({});
    try {
      const target = requestedPath?.trim() || (await sftpLocalHome());
      const listing = await sftpLocalList(target);
      setRootPath(listing.path);
      setPathInput(listing.path);
      setDirectories({
        [listing.path]: { entries: listing.entries, error: null, expanded: true, loading: false },
      });
    } catch (error) {
      setRootPath("");
      setRootError(error instanceof Error ? error.message : "读取本地目录失败。");
    }
  }, []);

  useEffect(() => {
    void loadRoot();
    void sftpLocalRoots().then(setRoots).catch(() => setRoots([]));
  }, [loadRoot]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  async function loadDirectory(path: string) {
    setDirectories((current) => ({
      ...current,
      [path]: { entries: current[path]?.entries ?? null, error: null, expanded: true, loading: true },
    }));
    try {
      const listing = await sftpLocalList(path);
      setDirectories((current) => ({
        ...current,
        [listing.path]: { entries: listing.entries, error: null, expanded: true, loading: false },
      }));
    } catch (error) {
      setDirectories((current) => ({
        ...current,
        [path]: {
          entries: null,
          error: error instanceof Error ? error.message : "读取本地目录失败。",
          expanded: true,
          loading: false,
        },
      }));
    }
  }

  async function toggleDirectory(path: string) {
    const state = directories[path];
    if (!state?.entries) {
      await loadDirectory(path);
      return;
    }
    setDirectories((current) => ({
      ...current,
      [path]: { ...current[path], expanded: !current[path].expanded },
    }));
  }

  function parentPath(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    if (separator === 2 && trimmed[1] === ":") {
      return trimmed.slice(0, 3);
    }
    if (separator <= 0) {
      return "/";
    }
    return trimmed.slice(0, separator);
  }

  function childPath(parent: string, name: string): string {
    if (parent.endsWith("/") || parent.endsWith("\\")) {
      return `${parent}${name}`;
    }
    return `${parent}/${name}`;
  }

  async function refreshAfterAction() {
    if (rootPath) {
      await loadRoot(rootPath);
    }
  }

  async function createEntry(kind: "file" | "directory") {
    const entry = contextMenu?.entry;
    if (!entry) {
      return;
    }
    const parent = entry.isDir ? entry.path : parentPath(entry.path);
    const name = window.prompt(kind === "file" ? "新建文件名" : "新建目录名", "")?.trim();
    if (!name) {
      return;
    }
    setContextMenu(null);
    try {
      if (kind === "file") {
        await sftpLocalCreateFile(parent, name);
      } else {
        await sftpLocalCreateDir(parent, name);
      }
      await refreshAfterAction();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "创建本地文件失败。");
    }
  }

  async function renameEntry() {
    const entry = contextMenu?.entry;
    if (!entry || entry.path === rootPath) {
      return;
    }
    const name = window.prompt("重命名", entry.name)?.trim();
    if (!name || name === entry.name) {
      return;
    }
    const nextPath = childPath(parentPath(entry.path), name);
    setContextMenu(null);
    try {
      await sftpLocalRename(entry.path, nextPath);
      onFileRenamed?.(entry.path, nextPath);
      await refreshAfterAction();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "重命名本地文件失败。");
    }
  }

  async function deleteEntry() {
    const entry = contextMenu?.entry;
    if (!entry || entry.path === rootPath || !window.confirm(`确定删除“${entry.name}”吗？`)) {
      return;
    }
    setContextMenu(null);
    try {
      await sftpLocalDelete(entry.path);
      onFileRemoved?.(entry.path);
      await refreshAfterAction();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除本地文件失败。");
    }
  }

  async function moveEntry(targetPath: string) {
    if (!draggedPath || draggedPath === targetPath) {
      setDraggedPath(null);
      setDropTargetPath(null);
      return;
    }
    const nextPath = childPath(targetPath, pathName(draggedPath));
    setDraggedPath(null);
    setDropTargetPath(null);
    try {
      await sftpLocalRename(draggedPath, nextPath);
      onFileRenamed?.(draggedPath, nextPath);
      await refreshAfterAction();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "移动本地文件失败。");
    }
  }

  function beginDrag(event: DragEvent<HTMLButtonElement>, path: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-dssh-local-path", path);
    setDraggedPath(path);
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>, path: string, isDirectory: boolean) {
    if (!draggedPath || !isDirectory) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetPath(path);
  }

  function renderDirectory(path: string, depth: number): ReactNode {
    const state = directories[path];
    if (!state?.expanded || !state.entries) {
      return state?.loading ? (
        <p className="remote-file-tree__loading" style={{ paddingLeft: `${12 + depth * 20}px` }}>读取中…</p>
      ) : state?.error ? (
        <p className="remote-file-tree__error" style={{ paddingLeft: `${12 + depth * 20}px` }}>{state.error}</p>
      ) : null;
    }
    return state.entries.map((entry) => {
      const childState = directories[entry.path];
      return (
        <div className="remote-file-tree__entry" key={entry.path}>
          <button
            className={`remote-file-tree__row remote-file-tree__row--${entry.isDir ? "directory" : "file"}`}
            data-active={entry.path === activeFilePath}
            data-local-drop-target={dropTargetPath === entry.path}
            draggable
            onDragEnd={() => {
              setDraggedPath(null);
              setDropTargetPath(null);
            }}
            onDragOver={(event) => handleDragOver(event, entry.path, entry.isDir)}
            onDrop={(event) => {
              if (draggedPath && entry.isDir) {
                event.preventDefault();
                void moveEntry(entry.path);
              }
            }}
            onDragStart={(event) => beginDrag(event, entry.path)}
            onClick={() => (entry.isDir ? void toggleDirectory(entry.path) : onOpenFile(entry))}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ entry, x: event.clientX, y: event.clientY });
            }}
            style={{ paddingLeft: `${8 + depth * 20}px` }}
            title={entry.path}
            type="button"
          >
            <span className="remote-file-tree__chevron" data-expanded={Boolean(childState?.expanded)}>
              {entry.isDir ? <Icon name="chevron-right" height="14" width="14" /> : null}
            </span>
            <Icon name={entry.isDir ? "folder" : fileIcon(entry)} height="15" width="15" />
            <span className="remote-file-tree__name">{entry.name}</span>
            {childState?.loading ? <span className="remote-file-tree__loading">读取中…</span> : null}
          </button>
          {entry.isDir && childState?.expanded ? renderDirectory(entry.path, depth + 1) : null}
        </div>
      );
    });
  }

  return (
    <section className="remote-file-tree local-file-tree" aria-label="本地文件列表">
      <header className="remote-file-tree__toolbar">
        <form
          className="remote-file-tree__path"
          onSubmit={(event) => {
            event.preventDefault();
            void loadRoot(pathInput);
          }}
        >
          {roots.length > 0 ? (
            <SelectMenu
              ariaLabel="本地位置"
              className="local-file-tree__root-select"
              onChange={(value) => {
                setPathInput(value);
                void loadRoot(value);
              }}
              options={[{ value: "", label: "位置" }, ...roots.map((root) => ({ value: root.path, label: root.label }))]}
              value={roots.some((root) => root.path === pathInput) ? pathInput : ""}
            />
          ) : null}
          <input
            aria-label="本地根路径"
            onChange={(event) => setPathInput(event.currentTarget.value)}
            placeholder="输入本地根路径"
            value={pathInput}
          />
        </form>
        <button className="remote-file-tree__refresh" onClick={() => void loadRoot(rootPath)} title="刷新" type="button">
          <Icon name="refresh" height="14" width="14" />
        </button>
        <button className="remote-file-tree__refresh" aria-label="关闭文件列表" onClick={onClose} title="关闭" type="button">
          <Icon name="close" height="14" width="14" />
        </button>
      </header>
      <div className="remote-file-tree__body">
        {rootError ? <p className="remote-file-tree__error">{rootError}</p> : rootPath ? (
          <>
            <button
              className="remote-file-tree__row remote-file-tree__row--root"
              data-local-drop-target={dropTargetPath === rootPath}
              onDragOver={(event) => handleDragOver(event, rootPath, true)}
              onClick={() => void toggleDirectory(rootPath)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  entry: { name: pathName(rootPath), path: rootPath, isDir: true, isSymlink: false, size: 0, modified: null },
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onDrop={(event) => {
                if (draggedPath) {
                  event.preventDefault();
                  void moveEntry(rootPath);
                }
              }}
              title={rootPath}
              type="button"
            >
              <span className="remote-file-tree__chevron" data-expanded={Boolean(directories[rootPath]?.expanded)}>
                <Icon name="chevron-right" height="14" width="14" />
              </span>
              <Icon name="folder" height="15" width="15" />
              <span className="remote-file-tree__name">{pathName(rootPath)}</span>
            </button>
            {renderDirectory(rootPath, 1)}
          </>
        ) : <p className="remote-file-tree__empty">输入路径后按回车打开本地目录。</p>}
      </div>
      {contextMenu ? (
        <div
          className="context-menu"
          onClick={(event) => event.stopPropagation()}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          <button className="context-menu__item" onClick={() => void createEntry("file")} type="button"><Icon name="file" height="14" width="14" />新建文件</button>
          <button className="context-menu__item" onClick={() => void createEntry("directory")} type="button"><Icon name="folder" height="14" width="14" />新建文件夹</button>
          {contextMenu.entry.path !== rootPath ? (
            <>
              <button className="context-menu__item" onClick={() => void renameEntry()} type="button"><Icon name="edit" height="14" width="14" />重命名</button>
              <button className="context-menu__item context-menu__item--danger" onClick={() => void deleteEntry()} type="button"><Icon name="trash" height="14" width="14" />删除</button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
