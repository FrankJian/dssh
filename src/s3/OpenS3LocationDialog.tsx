import { useState, type FormEvent } from "react";
import type { S3Bookmark } from "../models";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { useDialogFocus } from "../ui/useDialogFocus";
import { SettingsSwitch } from "../ui/SettingsSwitch";

interface Props {
  bookmarks: S3Bookmark[];
  onClose: () => void;
  onOpen: (location: string) => Promise<void>;
  onSaveBookmark: (location: string, name: string) => Promise<void>;
  onDeleteBookmark: (id: string) => Promise<void>;
}

export function OpenS3LocationDialog({
  bookmarks,
  onClose,
  onOpen,
  onSaveBookmark,
  onDeleteBookmark,
}: Props) {
  const dialogRef = useDialogFocus();
  const [location, setLocation] = useState("");
  const [bookmarkName, setBookmarkName] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (opening) return;
    if (!location.trim()) {
      setError("请输入存储桶名称或路径。");
      return;
    }
    setOpening(true);
    setError(null);
    try {
      await onOpen(location);
      if (remember) {
        await onSaveBookmark(location, bookmarkName);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开该 S3 路径。");
    } finally {
      setOpening(false);
    }
  }

  async function openBookmark(bookmark: S3Bookmark) {
    if (opening) return;
    const location = `${bookmark.bucket}${bookmark.prefix ? `/${bookmark.prefix}` : ""}`;
    setOpening(true);
    setError(null);
    try {
      setLocation(location);
      await onOpen(location);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开该 S3 路径。");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section ref={dialogRef} className="s3-open-location-dialog" role="dialog" aria-modal="true" aria-label="打开 S3 路径"
        onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !opening) { event.stopPropagation(); onClose(); } }}>
        <header className="profile-editor__topbar">
          <h2>打开 S3 路径</h2>
          <button className="icon-button" aria-label="关闭" disabled={opening} onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <form className="s3-open-location-dialog__body" onSubmit={submit}>
          <label className="field">
            <span>存储桶或路径</span>
            <input
              autoFocus
              disabled={opening}
              title="可直接访问未列出的存储桶。支持 bucket-name/folder 或 s3://bucket-name/folder。"
              placeholder="bucket-name/path/to/folder"
              value={location}
              onChange={(event) => setLocation(event.currentTarget.value)}
            />
          </label>
          <label className="settings-control-row">
            <span>保存为常用路径</span>
            <SettingsSwitch
              checked={remember}
              disabled={opening}
              onChange={(event) => setRemember(event.currentTarget.checked)}
            />
          </label>
          {remember ? (
            <label className="field">
              <span>书签名称（可选）</span>
              <input
                disabled={opening}
                placeholder="例如：生产环境日志"
                value={bookmarkName}
                onChange={(event) => setBookmarkName(event.currentTarget.value)}
              />
            </label>
          ) : null}
          {bookmarks.length ? <div className="s3-open-location-dialog__bookmarks">
            <div className="s3-open-location-dialog__bookmarks-title">常用路径</div>
              <div className="s3-open-location-dialog__bookmark-list">
                {bookmarks.map((bookmark) => (
                  <div className="s3-open-location-dialog__bookmark" key={bookmark.id}>
                    <button
                      disabled={opening}
                      onClick={() => void openBookmark(bookmark)}
                      type="button"
                    >
                      <span>{bookmark.name}</span>
                      <small>{bookmark.bucket}{bookmark.prefix ? `/${bookmark.prefix}` : ""}</small>
                    </button>
                    <button
                      aria-label={`删除书签 ${bookmark.name}`}
                      className="icon-button"
                      disabled={opening}
                      onClick={() => void onDeleteBookmark(bookmark.id)}
                      type="button"
                    >
                      <Icon name="trash" height="15" width="15" />
                    </button>
                  </div>
                ))}
              </div>
          </div> : null}
          {error ? <div className="form-errors" role="alert">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={opening} onClick={onClose} variant="ghost">取消</Button>
            <Button disabled={opening} type="submit" variant="primary">
              {opening ? "打开中..." : "打开"}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
