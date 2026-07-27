import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  onSftpDownloadProgress,
  sftpDownload,
  sftpDownloadDir,
  sftpHome,
  sftpList,
  sftpUpload,
  type SftpEntry,
} from "../services/sftpService";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { SectionHeader } from "../ui/SectionHeader";

interface FileBrowserProps {
  profileId: string | null;
  /** Enter the given remote directory in the active terminal (`cd <dir>`). */
  onOpenInTerminal?: (dir: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unitIndex]}`;
}

function parentPath(path: string): string {
  if (path === "/" || path === "") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return trimmed.slice(0, index);
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function joinRemote(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`;
}

/** Split a raw path input into the directory to list and the prefix to match. */
function splitPathValue(value: string, fallbackDir: string): { dir: string; prefix: string } {
  const slash = value.lastIndexOf("/");
  if (slash === -1) {
    return { dir: fallbackDir || "/", prefix: value };
  }
  if (slash === 0) {
    return { dir: "/", prefix: value.slice(1) };
  }
  return { dir: value.slice(0, slash), prefix: value.slice(slash + 1) };
}

export function FileBrowser({ profileId, onOpenInTerminal }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [pathInput, setPathInput] = useState<string>("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SftpEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [isDragOver, setIsDragOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(
    null,
  );
  const [progress, setProgress] = useState<{
    name: string;
    transferred: number;
    total: number | null;
  } | null>(null);
  const progressPathRef = useRef<string | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSeq = useRef(0);
  const dirCacheRef = useRef<Map<string, SftpEntry[]>>(new Map());
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const activeProfileRef = useRef(profileId);
  activeProfileRef.current = profileId;
  const dragStateRef = useRef({ currentPath, isBusy, profileId });
  dragStateRef.current = { currentPath, isBusy, profileId };

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setHighlightIndex(-1);
    if (suggestTimer.current) {
      clearTimeout(suggestTimer.current);
      suggestTimer.current = null;
    }
  }, []);

  const fetchSuggestions = useCallback(
    (value: string) => {
      if (!profileId) {
        return;
      }
      const { dir, prefix } = splitPathValue(value, currentPath);
      const lowerPrefix = prefix.toLowerCase();

      const applyMatches = (entries: SftpEntry[]) => {
        const matches = entries
          .filter((entry) => entry.isDir && entry.name.toLowerCase().startsWith(lowerPrefix))
          .slice(0, 100);
        setSuggestions(matches);
        setShowSuggestions(matches.length > 0);
        setHighlightIndex(-1);
      };

      // Serve from cache instantly so drilling down feels immediate.
      const cached = dirCacheRef.current.get(dir);
      if (cached) {
        applyMatches(cached);
        return;
      }

      const seq = suggestSeq.current + 1;
      suggestSeq.current = seq;
      sftpList(profileId, dir)
        .then((listing) => {
          dirCacheRef.current.set(dir, listing.entries);
          if (seq !== suggestSeq.current) {
            return;
          }
          applyMatches(listing.entries);
        })
        .catch(() => {
          if (seq !== suggestSeq.current) {
            return;
          }
          setSuggestions([]);
          setShowSuggestions(false);
        });
    },
    [currentPath, profileId],
  );

  function handlePathInputChange(value: string) {
    setPathInput(value);
    if (suggestTimer.current) {
      clearTimeout(suggestTimer.current);
      suggestTimer.current = null;
    }
    // Show the next level immediately when a separator is typed or the target
    // directory is already cached; otherwise debounce the network lookup.
    const { dir } = splitPathValue(value, currentPath);
    if (value.endsWith("/") || dirCacheRef.current.has(dir)) {
      fetchSuggestions(value);
    } else {
      suggestTimer.current = setTimeout(() => fetchSuggestions(value), 120);
    }
  }

  // After Tab: append the chosen directory + "/" and immediately suggest its
  // children, letting the user keep drilling down from the keyboard.
  function acceptSuggestion(entry: SftpEntry) {
    const next = `${entry.path.replace(/\/+$/, "")}/`;
    setPathInput(next);
    setHighlightIndex(-1);
    fetchSuggestions(next);
  }

  // Warm the cache with the immediate subdirectories so drilling in is instant.
  // Runs sequentially in the background to avoid flooding the SFTP channel.
  const preloadChildren = useCallback(
    (entries: SftpEntry[]) => {
      const id = profileId;
      if (!id) {
        return;
      }
      const targets = entries
        .filter((entry) => entry.isDir && !dirCacheRef.current.has(entry.path))
        .slice(0, 16);
      let chain = Promise.resolve();
      for (const entry of targets) {
        chain = chain.then(() => {
          if (activeProfileRef.current !== id || dirCacheRef.current.has(entry.path)) {
            return;
          }
          return sftpList(id, entry.path)
            .then((listing) => {
              if (activeProfileRef.current === id) {
                dirCacheRef.current.set(listing.path, listing.entries);
              }
            })
            .catch(() => {});
        });
      }
    },
    [profileId],
  );

  const loadPath = useCallback(
    async (path: string, options?: { force?: boolean }) => {
      if (!profileId) {
        return;
      }
      // Serve from cache for instant navigation unless a refresh is forced.
      const cached = options?.force ? undefined : dirCacheRef.current.get(path);
      if (cached) {
        setCurrentPath(path);
        setPathInput(path);
        setEntries(cached);
        setErrorMessage(null);
        preloadChildren(cached);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const listing = await sftpList(profileId, path);
        dirCacheRef.current.set(listing.path, listing.entries);
        setCurrentPath(listing.path);
        setPathInput(listing.path);
        setEntries(listing.entries);
        preloadChildren(listing.entries);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "读取目录失败。");
      } finally {
        setIsLoading(false);
      }
    },
    [preloadChildren, profileId],
  );

  function pickSuggestion(entry: SftpEntry) {
    closeSuggestions();
    setPathInput(entry.path);
    void loadPath(entry.path);
  }

  useEffect(() => {
    const unlisten = onSftpDownloadProgress((event) => {
      if (event.profileId !== profileId || event.path !== progressPathRef.current) {
        return;
      }
      setProgress((current) =>
        current
          ? { ...current, transferred: event.transferred, total: event.total ?? current.total }
          : current,
      );
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [profileId]);

  useEffect(() => {
    if (highlightIndex >= 0) {
      activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      return;
    }
    const margin = 8;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const x = Math.max(margin, Math.min(contextMenu.x, window.innerWidth - rect.width - margin));
    const y = Math.max(margin, Math.min(contextMenu.y, window.innerHeight - rect.height - margin));
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((current) => (current ? { ...current, x, y } : null));
    }
  }, [contextMenu]);

  useEffect(() => {
    let cancelled = false;
    dirCacheRef.current.clear();
    if (!profileId) {
      setEntries([]);
      setCurrentPath("");
      setPathInput("");
      setErrorMessage(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    sftpHome(profileId)
      .then((home) => sftpList(profileId, home))
      .then((listing) => {
        if (cancelled) {
          return;
        }
        dirCacheRef.current.set(listing.path, listing.entries);
        setCurrentPath(listing.path);
        setPathInput(listing.path);
        setEntries(listing.entries);
        preloadChildren(listing.entries);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "连接文件系统失败。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [preloadChildren, profileId]);

  function handleOpenEntry(entry: SftpEntry) {
    if (entry.isDir) {
      void loadPath(entry.path);
    } else {
      void handleDownload(entry);
    }
  }

  async function handleDownload(entry: SftpEntry) {
    if (!profileId || isBusy) {
      return;
    }
    try {
      const destination = await save({ defaultPath: entry.name });
      if (!destination) {
        return;
      }
      setIsBusy(true);
      setErrorMessage(null);
      progressPathRef.current = entry.path;
      setProgress({ name: entry.name, transferred: 0, total: entry.size });
      await sftpDownload(profileId, entry.path, destination);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "下载文件失败。");
    } finally {
      setIsBusy(false);
      progressPathRef.current = null;
      setProgress(null);
    }
  }

  // Directories are packed into a gzip'd tarball on the server, then streamed down.
  async function handleDownloadDir(entry: SftpEntry) {
    if (!profileId || isBusy) {
      return;
    }
    try {
      const destination = await save({
        defaultPath: `${entry.name}.tar.gz`,
        filters: [{ extensions: ["tar.gz", "tgz"], name: "Gzip 压缩包" }],
      });
      if (!destination) {
        return;
      }
      setIsBusy(true);
      setErrorMessage(null);
      progressPathRef.current = entry.path;
      setProgress({ name: `${entry.name}.tar.gz`, transferred: 0, total: null });
      await sftpDownloadDir(profileId, entry.path, destination);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "下载目录失败。");
    } finally {
      setIsBusy(false);
      progressPathRef.current = null;
      setProgress(null);
    }
  }

  function handleDownloadEntry(entry: SftpEntry) {
    if (entry.isDir) {
      void handleDownloadDir(entry);
    } else {
      void handleDownload(entry);
    }
  }

  const uploadFiles = useCallback(
    async (files: string[]) => {
      const { currentPath: dir, isBusy: busy, profileId: id } = dragStateRef.current;
      if (!id || busy || files.length === 0) {
        return;
      }
      setIsBusy(true);
      setErrorMessage(null);
      try {
        for (const file of files) {
          await sftpUpload(id, file, joinRemote(dir, baseName(file)));
        }
        dirCacheRef.current.delete(dir);
        await loadPath(dir, { force: true });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "上传文件失败。");
      } finally {
        setIsBusy(false);
      }
    },
    [loadPath],
  );

  async function handleUpload() {
    if (!profileId || isBusy) {
      return;
    }
    const selected = await open({ multiple: true, title: "选择要上传的文件" });
    if (!selected) {
      return;
    }
    await uploadFiles(Array.isArray(selected) ? selected : [selected]);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    function isInsidePanel(position: { x: number; y: number }) {
      const element = panelRef.current;
      if (!element) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = position.x / dpr;
      const y = position.y / dpr;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragOver(isInsidePanel(payload.position));
        } else if (payload.type === "leave") {
          setIsDragOver(false);
        } else if (payload.type === "drop") {
          const inside = isInsidePanel(payload.position);
          setIsDragOver(false);
          if (inside && payload.paths.length > 0) {
            void uploadFiles(payload.paths);
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
      unlisten?.();
    };
  }, [uploadFiles]);

  const atRoot = currentPath === "/" || currentPath === "";

  return (
    <aside
      className={`sidebar${isDragOver && profileId ? " is-drag-over" : ""}`}
      aria-label="文件列表"
      ref={panelRef}
    >
      {isDragOver && profileId ? (
        <div className="file-browser__dropzone">松开鼠标上传到当前目录</div>
      ) : null}
      <div className="sidebar__top">
        <SectionHeader title="文件列表" />
        <div className="file-browser__toolbar">
          <IconButton
            disabled={!profileId || isBusy}
            label="刷新"
            onClick={() => {
              dirCacheRef.current.clear();
              void loadPath(currentPath, { force: true });
            }}
          >
            <Icon name="refresh" />
          </IconButton>
          <IconButton
            className="icon-button--primary"
            disabled={!profileId || isBusy}
            label="上传文件"
            onClick={() => void handleUpload()}
          >
            <Icon name="upload" />
          </IconButton>
        </div>
      </div>

      {!profileId ? (
        <div className="file-browser__hint">请先连接一个 SSH 会话，然后在此浏览远程文件。</div>
      ) : (
        <>
          <form
            className="file-browser__path"
            onSubmit={(event) => {
              event.preventDefault();
              closeSuggestions();
              const target = pathInput.trim();
              if (target) {
                void loadPath(target);
              }
            }}
          >
            <IconButton
              disabled={atRoot || isLoading}
              label="上一级"
              onClick={() => void loadPath(parentPath(currentPath))}
            >
              <Icon name="arrowUp" />
            </IconButton>
            <input
              aria-label="目录路径"
              className="file-browser__path-input"
              disabled={isLoading || isBusy}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              onChange={(event) => handlePathInputChange(event.currentTarget.value)}
              onFocus={() => fetchSuggestions(pathInput)}
              onKeyDown={(event) => {
                if (!showSuggestions || suggestions.length === 0) {
                  if (event.key === "Escape") {
                    closeSuggestions();
                  }
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlightIndex((index) => Math.min(index + 1, suggestions.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlightIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  const target = suggestions[highlightIndex >= 0 ? highlightIndex : 0];
                  if (target) {
                    acceptSuggestion(target);
                  }
                } else if (event.key === "Enter") {
                  if (highlightIndex >= 0) {
                    event.preventDefault();
                    pickSuggestion(suggestions[highlightIndex]);
                  }
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeSuggestions();
                }
              }}
              placeholder="输入路径，Tab 逐级补全"
              spellCheck={false}
              value={pathInput}
            />
            {showSuggestions && suggestions.length > 0 ? (
              <ul className="file-browser__suggestions" role="listbox">
                {suggestions.map((entry, index) => (
                  <li key={entry.path}>
                    <button
                      className={`file-browser__suggestion${
                        index === highlightIndex ? " is-active" : ""
                      }`}
                      onClick={() => pickSuggestion(entry)}
                      onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightIndex(index)}
                    ref={index === highlightIndex ? activeItemRef : undefined}
                    role="option"
                    aria-selected={index === highlightIndex}
                    type="button"
                  >
                      <Icon className="file-row__icon" name="folder" />
                      <span className="file-browser__suggestion-name" title={entry.path}>
                        {entry.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </form>

          {errorMessage ? <div className="sidebar__error">{errorMessage}</div> : null}

          {progress ? (
            <div className="file-browser__progress">
              <div className="file-browser__progress-label">
                <span className="file-browser__progress-name" title={progress.name}>
                  下载 {progress.name}
                </span>
                <span className="file-browser__progress-size">
                  {formatSize(progress.transferred)}
                  {progress.total != null ? ` / ${formatSize(progress.total)}` : ""}
                </span>
              </div>
              <div className="file-browser__progress-track">
                <div
                  className="file-browser__progress-bar"
                  data-indeterminate={progress.total == null}
                  style={
                    progress.total != null && progress.total > 0
                      ? {
                          width: `${Math.min(
                            100,
                            Math.round((progress.transferred / progress.total) * 100),
                          )}%`,
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          ) : null}

          <div className="file-list" role="list">
            {isLoading ? (
              <div className="file-list__empty">正在加载...</div>
            ) : entries.length > 0 ? (
              entries.map((entry) => (
                <div
                  className="file-row"
                  key={entry.path}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, entry });
                  }}
                  onDoubleClick={() => handleOpenEntry(entry)}
                  role="listitem"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleOpenEntry(entry);
                    }
                  }}
                >
                  <Icon className="file-row__icon" name={entry.isDir ? "folder" : "file"} />
                  <span className="file-row__name" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.isDir ? null : (
                    <>
                      <span className="file-row__meta">{formatSize(entry.size)}</span>
                      <IconButton
                        disabled={isBusy}
                        label="下载"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDownload(entry);
                        }}
                      >
                        <Icon name="download" />
                      </IconButton>
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="file-list__empty">此目录为空。</div>
            )}
          </div>
        </>
      )}
      {contextMenu ? (
        <div
          className="context-menu"
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          {onOpenInTerminal ? (
            <button
              className="context-menu__item"
              onClick={() => {
                const entry = contextMenu.entry;
                setContextMenu(null);
                onOpenInTerminal(entry.isDir ? entry.path : parentPath(entry.path));
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="terminalTool" height="15" width="15" />
              <span>{contextMenu.entry.isDir ? "在终端中进入此目录" : "在终端中进入所在目录"}</span>
            </button>
          ) : null}
          <button
            className="context-menu__item"
            disabled={isBusy}
            onClick={() => {
              const entry = contextMenu.entry;
              setContextMenu(null);
              handleDownloadEntry(entry);
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="download" height="15" width="15" />
            <span>{contextMenu.entry.isDir ? "打包下载" : "下载"}</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
