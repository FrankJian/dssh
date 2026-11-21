import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
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
import { createPortal } from "react-dom";
import { dismissMenu, handleMenuNavigation } from "../ui/menuNavigation";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { toast } from "../ui/ToastHost";
import { Icon } from "../ui/Icon";
import { FileEntryIcon } from "./FileEntryIcon";
import { SelectMenu } from "../ui/SelectMenu";

interface LocalFileTreeProps {
  activeFilePath: string | null;
  initialRootPath?: string;
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

interface EntryAction {
  kind: "file" | "directory" | "rename" | "delete";
  entry: LocalFileEntry;
  name: string;
}

function pathName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

/** Local counterpart of RemoteFileTree. It intentionally has no transfer or
 * drag/drop actions: the local terminal only needs browsing and editing. */
export function LocalFileTree({
  activeFilePath,
  initialRootPath,
  onClose,
  onFileRemoved,
  onFileRenamed,
  onOpenFile,
}: LocalFileTreeProps) {
  const [rootPath, setRootPath] = useState("");
  const [pathInput, setPathInput] = useState(initialRootPath ?? "");
  const [roots, setRoots] = useState<LocalRoot[]>([]);
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rootInputRef = useRef<HTMLInputElement>(null);
  const actionFormId = useId();
  const [action, setAction] = useState<EntryAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const loadRoot = useCallback(async (requestedPath?: string) => {
    setRootError(null);
    setDirectories({});
    try {
      const target = requestedPath?.trim() ? requestedPath : await sftpLocalHome();
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
    void loadRoot(initialRootPath);
  }, [initialRootPath, loadRoot]);

  useEffect(() => {
    void sftpLocalRoots().then(setRoots).catch(() => setRoots([]));
  }, []);

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

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!contextMenu || !menu) return;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [contextMenu]);

  function closeContextMenu() {
    dismissMenu(() => setContextMenu(null), menuTriggerRef.current);
  }

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

  function beginAction(kind: EntryAction["kind"]) {
    const entry = contextMenu?.entry;
    if (!entry || ((kind === "rename" || kind === "delete") && entry.path === rootPath)) return;
    closeContextMenu();
    setActionError(null);
    setAction({ kind, entry, name: kind === "rename" ? entry.name : "" });
  }

  async function submitAction() {
    if (!action || actionBusy) return;
    const { kind, entry } = action;
    const name = action.name.trim();
    if (kind !== "delete" && !name) {
      setActionError("请输入名称。");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      if (kind === "file" || kind === "directory") {
        const parent = entry.isDir ? entry.path : parentPath(entry.path);
        if (kind === "file") await sftpLocalCreateFile(parent, name);
        else await sftpLocalCreateDir(parent, name);
      } else if (kind === "rename") {
        if (name !== entry.name) {
          const nextPath = childPath(parentPath(entry.path), name);
          await sftpLocalRename(entry.path, nextPath);
          onFileRenamed?.(entry.path, nextPath);
        }
      } else {
        await sftpLocalDelete(entry.path);
        onFileRemoved?.(entry.path);
      }
      await refreshAfterAction();
      setAction(null);
      // Refreshing replaces file rows; fall back to the stable path field.
      const owner = menuTriggerRef.current;
      window.requestAnimationFrame(() => (owner?.isConnected ? owner : rootInputRef.current)?.focus({ preventScroll: true }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "本地文件操作失败。");
    } finally {
      setActionBusy(false);
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
      toast(error instanceof Error ? error.message : "移动本地文件失败。", "error");
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
              menuTriggerRef.current = event.currentTarget;
              setContextMenu({ entry, x: event.clientX, y: event.clientY });
            }}
            style={{ paddingLeft: `${8 + depth * 20}px` }}
            title={entry.path}
            type="button"
          >
            <span className="remote-file-tree__chevron" data-expanded={Boolean(childState?.expanded)}>
              {entry.isDir ? <Icon name="chevron-right" height="14" width="14" /> : null}
            </span>
            <FileEntryIcon name={entry.name} directory={entry.isDir} expanded={childState?.expanded} symlink={entry.isSymlink} />
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
            ref={rootInputRef}
            autoFocus={Boolean(initialRootPath)}
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
                menuTriggerRef.current = event.currentTarget;
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
              <FileEntryIcon directory expanded={directories[rootPath]?.expanded} />
              <span className="remote-file-tree__name">{pathName(rootPath)}</span>
            </button>
            {renderDirectory(rootPath, 1)}
          </>
        ) : <p className="remote-file-tree__empty">输入路径后按回车打开本地目录。</p>}
      </div>
      {contextMenu ? createPortal(
        <div
          className="context-menu is-glass-overlay"
          ref={menuRef}
          role="menu"
          aria-label="本地文件操作"
          onKeyDown={(event) => handleMenuNavigation(event, closeContextMenu)}
          onClick={(event) => event.stopPropagation()}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          <button role="menuitem" className="context-menu__item" onClick={() => beginAction("file")} type="button"><Icon name="file" height="14" width="14" />新建文件</button>
          <button role="menuitem" className="context-menu__item" onClick={() => beginAction("directory")} type="button"><Icon name="folder" height="14" width="14" />新建文件夹</button>
          {contextMenu.entry.path !== rootPath ? (
            <>
              <button role="menuitem" className="context-menu__item" onClick={() => beginAction("rename")} type="button"><Icon name="edit" height="14" width="14" />重命名</button>
              <button role="menuitem" className="context-menu__item context-menu__item--danger" onClick={() => beginAction("delete")} type="button"><Icon name="trash" height="14" width="14" />删除</button>
            </>
          ) : null}
        </div>, document.body,
      ) : null}
      {action ? <Dialog
        title={action.kind === "file" ? "新建文件" : action.kind === "directory" ? "新建文件夹" : action.kind === "rename" ? "重命名" : "删除本地文件"}
        busy={actionBusy}
        initialFocusSelector={action.kind === "delete" ? undefined : "input"}
        onClose={() => setAction(null)}
        footer={<>
          <Button disabled={actionBusy} onClick={() => setAction(null)} variant="ghost">取消</Button>
          <Button disabled={actionBusy} variant={action.kind === "delete" ? "danger" : "primary"}
            type={action.kind === "delete" ? "button" : "submit"} form={actionFormId}
            onClick={action.kind === "delete" ? () => void submitAction() : undefined}>
            {actionBusy ? "正在处理…" : action.kind === "delete" ? "删除" : action.kind === "rename" ? "保存名称" : "创建"}
          </Button>
        </>}>
        {action.kind === "delete" ? <p>确定删除“{action.entry.name}”？此操作无法恢复。</p> : <form id={actionFormId} onSubmit={(event) => { event.preventDefault(); void submitAction(); }}>
          <label className="field"><span>{action.kind === "rename" ? "新名称" : action.kind === "file" ? "文件名" : "文件夹名称"}</span>
            <input disabled={actionBusy} value={action.name} onChange={(event) => { setAction({ ...action, name: event.currentTarget.value }); setActionError(null); }} />
          </label>
        </form>}
        {actionError ? <p className="app-dialog__error" role="alert">{actionError}</p> : null}
      </Dialog> : null}
    </section>
  );
}
