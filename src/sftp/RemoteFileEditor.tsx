import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  EDITOR_LANGUAGE_OPTIONS,
  languageForPath,
  languageLabel,
  MonacoRemoteEditor,
} from "./MonacoRemoteEditor";
import { MermaidDiagram } from "./MermaidDiagram";
import {
  sftpLocalReadImage,
  sftpLocalReadText,
  sftpLocalWriteText,
  sftpReadImage,
  sftpReadText,
  sftpWriteText,
} from "../services/sftpService";
import type { EditorOptions } from "../settings/settings";
import { Icon } from "../ui/Icon";
import { toast } from "../ui/ToastHost";

interface RemoteFileEditorProps {
  activePath: string | null;
  editorOptions: EditorOptions;
  filePaths: string[];
  onCloseFile: (path: string) => void;
  onSelectFile: (path: string) => void;
  onShowTerminal: () => void;
  profileId: string;
  fileSystem?: "remote" | "local";
}

interface EditorDocument {
  content: string;
  error: string | null;
  isLoading: boolean;
  isSaving: boolean;
  savedContent: string;
}

interface ImageDocument {
  dataUrl: string;
  error: string | null;
  isLoading: boolean;
}

interface ClosePrompt {
  path: string;
  remainingPaths: string[];
}

interface TabContextMenu {
  path: string;
  x: number;
  y: number;
}

function fileName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || path;
}

function isDirty(document: EditorDocument | undefined): boolean {
  return Boolean(document && !document.isLoading && document.content !== document.savedContent);
}

function isImagePath(path: string | null): boolean {
  return Boolean(path && ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(path.split(".").pop()?.toLowerCase() ?? ""));
}

function isMarkdownPath(path: string | null): boolean {
  return Boolean(path && ["md", "markdown"].includes(path.split(".").pop()?.toLowerCase() ?? ""));
}

function isKnownBinaryPath(path: string | null): boolean {
  return Boolean(path && [
    "7z", "apk", "bin", "bz2", "class", "db", "dmg", "dll", "doc", "docx", "ear", "exe", "gz", "iso",
    "jar", "msi", "o", "odp", "ods", "odt", "pdf", "pyc", "rar", "so", "tar", "tgz", "war", "woff", "woff2",
    "xls", "xlsx", "xz", "zip", "zst",
  ].includes(path.split(".").pop()?.toLowerCase() ?? ""));
}

const DEFAULT_PREVIEW_WIDTH = 420;
const MIN_PREVIEW_WIDTH = 260;
const MAX_PREVIEW_WIDTH = 720;

/** Remote-file editor shell: tabs, SFTP save flow and non-text previews stay
 * here while Monaco owns only the editable text surface. */
export function RemoteFileEditor({
  activePath,
  editorOptions,
  filePaths,
  onCloseFile,
  onSelectFile,
  onShowTerminal,
  profileId,
  fileSystem = "remote",
}: RemoteFileEditorProps) {
  const isLocalFileSystem = fileSystem === "local";
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>({});
  const [images, setImages] = useState<Record<string, ImageDocument>>({});
  const [closePrompt, setClosePrompt] = useState<ClosePrompt | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenu | null>(null);
  const [markdownPreviewPath, setMarkdownPreviewPath] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);
  const [languageOverrides, setLanguageOverrides] = useState<Record<string, string>>({});
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    // Each SFTP profile has an independent remote namespace. Clear cached
    // documents before the profile-specific read effects run so a same-path
    // file is never shown with content from the previous host.
    documentsRef.current = {};
    imagesRef.current = {};
    setDocuments({});
    setImages({});
    setLanguageOverrides({});
    setMarkdownPreviewPath(null);
  }, [fileSystem, profileId]);

  useEffect(() => {
    // Do not depend on `documents`: marking a file as loading updates that
    // state, and would otherwise rerun this effect and cancel its own request.
    if (!activePath || isImagePath(activePath) || isKnownBinaryPath(activePath) || documentsRef.current[activePath]) {
      return;
    }
    let cancelled = false;
    setDocuments((current) => ({
      ...current,
      [activePath]: {
        content: "",
        error: null,
        isLoading: true,
        isSaving: false,
        savedContent: "",
      },
    }));
    void (isLocalFileSystem ? sftpLocalReadText(activePath) : sftpReadText(profileId, activePath))
      .then((file) => {
        if (cancelled) {
          return;
        }
        setDocuments((current) => ({
          ...current,
          [activePath]: {
            content: file.content,
            error: null,
            isLoading: false,
            isSaving: false,
            savedContent: file.content,
          },
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDocuments((current) => ({
          ...current,
          [activePath]: {
            content: "",
            error: error instanceof Error ? error.message : `无法读取${isLocalFileSystem ? "本地" : "远程"}文件。`,
            isLoading: false,
            isSaving: false,
            savedContent: "",
          },
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, fileSystem, isLocalFileSystem, profileId]);

  useEffect(() => {
    if (!activePath || !isImagePath(activePath) || imagesRef.current[activePath]) {
      return;
    }
    let cancelled = false;
    setImages((current) => ({
      ...current,
      [activePath]: { dataUrl: "", error: null, isLoading: true },
    }));
    void (isLocalFileSystem ? sftpLocalReadImage(activePath) : sftpReadImage(profileId, activePath))
      .then((image) => {
        if (cancelled) {
          return;
        }
        setImages((current) => ({
          ...current,
          [activePath]: { dataUrl: image.dataUrl, error: null, isLoading: false },
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setImages((current) => ({
          ...current,
          [activePath]: {
            dataUrl: "",
            error: error instanceof Error ? error.message : `无法读取${isLocalFileSystem ? "本地" : "远程"}图片。`,
            isLoading: false,
          },
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, fileSystem, isLocalFileSystem, profileId]);

  useEffect(() => {
    setDocuments((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([path]) => filePaths.includes(path)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [filePaths]);

  useEffect(() => {
    setLanguageOverrides((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([path]) => filePaths.includes(path)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [filePaths]);

  useEffect(() => {
    if (!tabContextMenu) {
      return;
    }
    const close = () => setTabContextMenu(null);
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
  }, [tabContextMenu]);

  useEffect(() => {
    if (!isMarkdownPath(activePath)) {
      setMarkdownPreviewPath(null);
    }
  }, [activePath]);

  useEffect(() => {
    setImages((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([path]) => filePaths.includes(path)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [filePaths]);

  const activeDocument = activePath ? documents[activePath] : undefined;
  const activeImage = activePath ? images[activePath] : undefined;
  const activeIsImage = isImagePath(activePath);
  const activeIsBinary = isKnownBinaryPath(activePath);
  const hasLoadedTextDocument = Object.values(documents).some((document) => !document.isLoading && !document.error);
  const activeIsDirty = isDirty(activeDocument);
  const title = activePath ? fileName(activePath) : "文件编辑器";
  const autoLanguage = activePath ? languageForPath(activePath) : "plaintext";
  const status = useMemo(() => {
    if (activeIsImage) {
      return activeImage?.isLoading ? "正在读取…" : "图片预览";
    }
    if (activeIsBinary) {
      return "二进制文件";
    }
    if (!activeDocument) {
      return "";
    }
    if (activeDocument.isLoading) {
      return "正在读取…";
    }
    if (activeDocument.isSaving) {
      return "正在保存…";
    }
    return activeIsDirty ? "未保存" : "已保存";
  }, [activeDocument, activeImage?.isLoading, activeIsBinary, activeIsDirty, activeIsImage]);
  const statusIcon = activeIsImage
    ? "fileImage"
    : activeIsBinary
      ? "file"
    : activeDocument?.isLoading || activeDocument?.isSaving
      ? "refresh"
      : activeIsDirty
        ? "edit"
        : "check";

  function updateContent(path: string, content: string) {
    setDocuments((current) => ({
      ...current,
      [path]: { ...current[path], content, error: null },
    }));
  }

  function setActiveLanguageOverride(languageId: string) {
    if (!activePath) {
      return;
    }
    setLanguageOverrides((current) => {
      if (languageId) {
        return { ...current, [activePath]: languageId };
      }
      const next = { ...current };
      delete next[activePath];
      return next;
    });
  }

  async function saveFile(path: string): Promise<boolean> {
    const document = documentsRef.current[path];
    if (!document || !isDirty(document)) {
      return true;
    }
    if (document.isSaving) {
      return false;
    }
    const content = document.content;
    setDocuments((current) => ({
      ...current,
      [path]: { ...current[path], error: null, isSaving: true },
    }));
    try {
      if (isLocalFileSystem) {
        await sftpLocalWriteText(path, content);
      } else {
        await sftpWriteText(profileId, path, content);
      }
      setDocuments((current) => ({
        ...current,
        [path]: {
          ...current[path],
          isSaving: false,
          savedContent: content,
        },
      }));
      toast(`已保存 ${fileName(path)}。`, "success");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : `保存${isLocalFileSystem ? "本地" : "远程"}文件失败。`;
      setDocuments((current) => ({
        ...current,
        [path]: { ...current[path], error: message, isSaving: false },
      }));
      toast(message, "error");
      return false;
    }
  }

  async function saveActiveFile() {
    if (activePath) {
      await saveFile(activePath);
    }
  }

  function closeFileNow(path: string) {
    if (markdownPreviewPath === path) {
      setMarkdownPreviewPath(null);
    }
    onCloseFile(path);
  }

  function closeQueuedFiles(paths: string[]) {
    const [path, ...remainingPaths] = paths;
    if (!path) {
      return;
    }
    if (isDirty(documentsRef.current[path])) {
      setClosePrompt({ path, remainingPaths });
      return;
    }
    closeFileNow(path);
    closeQueuedFiles(remainingPaths);
  }

  function closeFile(path: string) {
    closeQueuedFiles([path]);
  }

  function requestTabClose(paths: string[]) {
    setTabContextMenu(null);
    closeQueuedFiles(paths);
  }

  function startPreviewResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewWidth;
    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = startWidth + startX - moveEvent.clientX;
      setPreviewWidth(Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, Math.round(nextWidth))));
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <section className="remote-file-editor" aria-label={`${isLocalFileSystem ? "本地" : "远程"}文件编辑器`}>
      <header className="remote-file-editor__tabs" role="tablist" aria-label="已打开文件">
        <button
          aria-label="显示终端"
          className="remote-file-editor__terminal-button"
          onClick={onShowTerminal}
          title="显示终端"
          type="button"
        >
          <Icon name="terminalTool" height="16" width="16" />
        </button>
        {filePaths.map((path) => {
          const dirty = isDirty(documents[path]);
          const image = isImagePath(path);
          const binary = isKnownBinaryPath(path);
          return (
            <div
              aria-selected={path === activePath}
              className={`remote-file-editor__tab${path === activePath ? " is-active" : ""}`}
              key={path}
              onContextMenu={(event) => {
                event.preventDefault();
                setTabContextMenu({ path, x: event.clientX, y: event.clientY });
              }}
              role="tab"
            >
              <button
                className="remote-file-editor__tab-label"
                onClick={() => onSelectFile(path)}
                title={path}
                type="button"
              >
                <Icon name={image ? "fileImage" : binary ? "file" : "fileCode"} height="14" width="14" />
                <span>{fileName(path)}</span>
                {dirty ? <i aria-label="未保存" className="remote-file-editor__dirty" /> : null}
              </button>
              <button
                aria-label={`关闭 ${fileName(path)}`}
                className="remote-file-editor__tab-close"
                onClick={() => closeFile(path)}
                title="关闭"
                type="button"
              >
                <Icon name="close" height="13" width="13" />
              </button>
            </div>
          );
        })}
      </header>

      <div className="remote-file-editor__toolbar">
        <span className="remote-file-editor__path" title={activePath ?? undefined}>{activePath ?? title}</span>
        <select
          aria-label="编辑器语言"
          className="remote-file-editor__language"
          disabled={!activePath || activeIsImage || activeIsBinary || !activeDocument || activeDocument.isLoading}
          onChange={(event) => setActiveLanguageOverride(event.currentTarget.value)}
          title="手动选择语法高亮语言"
          value={activePath ? languageOverrides[activePath] ?? "" : ""}
        >
          <option value="">自动（{languageLabel(autoLanguage)}）</option>
          {EDITOR_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        {status ? (
          <span
            aria-label={status}
            className={`remote-file-editor__status${activeIsDirty ? " is-dirty" : ""}`}
            title={status}
          >
            <Icon name={statusIcon} height="14" width="14" />
          </span>
        ) : null}
        {isMarkdownPath(activePath) ? (
          <button
            aria-label={markdownPreviewPath === activePath ? "关闭 Markdown 预览" : "显示 Markdown 预览"}
            aria-pressed={markdownPreviewPath === activePath}
            className="remote-file-editor__preview-toggle"
            onClick={() => setMarkdownPreviewPath((current) => (current === activePath ? null : activePath))}
            title={markdownPreviewPath === activePath ? "关闭预览" : "显示预览"}
            type="button"
          >
            <Icon name="eye" height="14" width="14" />
          </button>
        ) : null}
        <button
          aria-label="保存"
          className="button button--primary remote-file-editor__save"
          disabled={activeIsImage || activeIsBinary || !activeIsDirty || activeDocument?.isSaving}
          onClick={() => void saveActiveFile()}
          title="保存"
          type="button"
        >
          <Icon name="save" height="14" width="14" />
        </button>
      </div>

      {activeIsImage && activeImage?.error ? (
        <p className="remote-file-editor__message remote-file-editor__message--error">{activeImage.error}</p>
      ) : activeIsImage && (!activeImage || activeImage.isLoading) ? (
        <p className="remote-file-editor__message">正在读取图片…</p>
      ) : activeIsImage && activeImage ? (
        <div className="remote-file-editor__image-wrap">
          <img alt={title} className="remote-file-editor__image" src={activeImage.dataUrl} />
        </div>
      ) : activeIsBinary ? (
        <p className="remote-file-editor__message">该文件是二进制或压缩格式，无法在内置编辑器中预览。请下载后使用对应程序打开。</p>
      ) : activeDocument?.error ? (
        <p className="remote-file-editor__message remote-file-editor__message--error">{activeDocument.error}</p>
      ) : activeDocument?.isLoading ? (
        <p className="remote-file-editor__message">正在读取文件内容…</p>
      ) : activeDocument ? null : (
        <p className="remote-file-editor__message">从左侧文件列表选择一个文本文件以打开编辑器。</p>
      )}
      <div
        className="remote-file-editor__content"
        data-hidden={activeIsImage || activeIsBinary || !activeDocument || activeDocument.isLoading || Boolean(activeDocument.error)}
      >
        <MonacoRemoteEditor
          activePath={activePath}
          documents={documents}
          editorOptions={editorOptions}
          filePaths={filePaths}
          hidden={activeIsImage || activeIsBinary || !activeDocument || activeDocument.isLoading || Boolean(activeDocument.error)}
          languageOverrides={languageOverrides}
          onContentChange={updateContent}
          onSave={() => void saveActiveFile()}
          profileId={`${fileSystem}:${profileId}`}
          shouldLoad={hasLoadedTextDocument}
        />
        {markdownPreviewPath === activePath && activeDocument ? (
          <>
              <div
                aria-label="调整 Markdown 预览宽度"
                aria-orientation="vertical"
                className="remote-file-editor__preview-divider"
                onMouseDown={startPreviewResize}
                role="separator"
              />
              <aside className="remote-file-editor__preview" style={{ width: `${previewWidth}px` }}>
                <header className="remote-file-editor__preview-header">
                  <span>预览</span>
                  <button
                    aria-label="关闭 Markdown 预览"
                    className="remote-file-editor__preview-close"
                    onClick={() => setMarkdownPreviewPath(null)}
                    title="关闭预览"
                    type="button"
                  >
                    <Icon name="close" height="14" width="14" />
                  </button>
                </header>
                <div className="remote-file-editor__markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ node: _node, ...props }) => <a {...props} rel="noreferrer" target="_blank" />,
                      code: ({ className, children, node: _node, ...props }) => {
                        const language = /language-([^\s]+)/.exec(className ?? "")?.[1]?.toLowerCase();
                        if (language === "mermaid") {
                          return <MermaidDiagram chart={String(children).replace(/\n$/, "")} />;
                        }
                        return <code className={className} {...props}>{children}</code>;
                      },
                    }}
                  >
                    {activeDocument.content}
                  </ReactMarkdown>
                </div>
              </aside>
          </>
        ) : null}
      </div>
      {tabContextMenu ? (
        <div
          className="context-menu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
        >
          <button
            className="context-menu__item"
            onClick={() => requestTabClose([tabContextMenu.path])}
            role="menuitem"
            type="button"
          >
            <Icon name="close" height="15" width="15" />
            <span>关闭</span>
          </button>
          <button
            className="context-menu__item"
            disabled={filePaths.length <= 1}
            onClick={() => requestTabClose(filePaths.filter((path) => path !== tabContextMenu.path))}
            role="menuitem"
            type="button"
          >
            <Icon name="close" height="15" width="15" />
            <span>关闭其他</span>
          </button>
          <button
            className="context-menu__item"
            disabled={filePaths.indexOf(tabContextMenu.path) === filePaths.length - 1}
            onClick={() => requestTabClose(filePaths.slice(filePaths.indexOf(tabContextMenu.path) + 1))}
            role="menuitem"
            type="button"
          >
            <Icon name="arrowDownRight" height="15" width="15" />
            <span>关闭右侧标签</span>
          </button>
          <button
            className="context-menu__item"
            onClick={() => requestTabClose(filePaths.filter((path) => !isDirty(documents[path])))}
            role="menuitem"
            type="button"
          >
            <Icon name="check" height="15" width="15" />
            <span>关闭已保存标签</span>
          </button>
          <button
            className="context-menu__item"
            onClick={() => requestTabClose(filePaths)}
            role="menuitem"
            type="button"
          >
            <Icon name="trash" height="15" width="15" />
            <span>关闭全部</span>
          </button>
        </div>
      ) : null}
      {closePrompt ? (
        <div className="remote-file-editor__confirm-backdrop" role="presentation">
          <section
            aria-label="未保存修改"
            aria-modal="true"
            className="remote-file-editor__confirm"
            role="dialog"
          >
            <h2>保存修改？</h2>
            <p>“{fileName(closePrompt.path)}”有未保存的修改。</p>
            <div className="remote-file-editor__confirm-actions">
              <button className="button button--ghost" onClick={() => setClosePrompt(null)} type="button">取消</button>
              <button
                className="button button--ghost"
                onClick={() => {
                  const { path, remainingPaths } = closePrompt;
                  setClosePrompt(null);
                  closeFileNow(path);
                  closeQueuedFiles(remainingPaths);
                }}
                type="button"
              >
                放弃修改
              </button>
              <button
                className="button button--primary"
                onClick={() => {
                  const { path, remainingPaths } = closePrompt;
                  void saveFile(path).then((saved) => {
                    if (saved) {
                      setClosePrompt(null);
                      closeFileNow(path);
                      closeQueuedFiles(remainingPaths);
                    }
                  });
                }}
                type="button"
              >
                保存并关闭
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
