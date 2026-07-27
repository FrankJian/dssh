import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { S3CleanupObject } from "../models";
import { previewS3Cleanup } from "../services/s3Service";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface Props {
  profileId: string;
  bucket: string;
  prefix: string;
  onClose: () => void;
  onDelete: (keys: string[]) => Promise<void>;
}

interface CleanupTreeFolder {
  name: string;
  path: string;
  folders: CleanupTreeFolder[];
  objects: S3CleanupObject[];
}

function formatSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit && value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function defaultCutoff() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatTimeDistance(value: string, now: number) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "请输入有效的时间";
  const difference = Math.round((now - timestamp) / 1000);
  const future = difference < 0;
  let remaining = Math.abs(difference);
  const units: Array<[string, number]> = [
    ["年", 365 * 24 * 60 * 60],
    ["天", 24 * 60 * 60],
    ["小时", 60 * 60],
    ["分钟", 60],
  ];
  const parts: string[] = [];
  for (const [label, seconds] of units) {
    if (remaining < seconds && parts.length === 0) continue;
    const count = Math.floor(remaining / seconds);
    if (count) parts.push(`${count}${label}`);
    remaining %= seconds;
    if (parts.length === 2) break;
  }
  if (!parts.length) parts.push("0分钟");
  return future ? `晚于当前时间 ${parts.join("")}` : `距今 ${parts.join("")}`;
}

function cleanupFolderName(prefix: string) {
  return prefix.replace(/\/$/, "").split("/").pop() || prefix;
}

function buildTree(prefix: string, objects: S3CleanupObject[]): CleanupTreeFolder {
  const root: CleanupTreeFolder = { name: cleanupFolderName(prefix), path: "", folders: [], objects: [] };
  const folders = new Map<string, CleanupTreeFolder>([["", root]]);

  for (const object of objects) {
    const relative = object.key.slice(prefix.length);
    const parts = relative.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    let parentPath = "";
    let parent = root;
    for (const part of parts) {
      const currentPath = parentPath ? `${parentPath}/${part}` : part;
      let folder = folders.get(currentPath);
      if (!folder) {
        folder = { name: part, path: currentPath, folders: [], objects: [] };
        folders.set(currentPath, folder);
        parent.folders.push(folder);
      }
      parent = folder;
      parentPath = currentPath;
    }
    parent.objects.push(object);
  }

  function sortFolder(folder: CleanupTreeFolder) {
    folder.folders.sort((left, right) => left.name.localeCompare(right.name));
    folder.objects.sort((left, right) => left.key.localeCompare(right.key));
    folder.folders.forEach(sortFolder);
  }
  sortFolder(root);
  return root;
}

function collectKeys(folder: CleanupTreeFolder): string[] {
  return [
    ...folder.objects.map((object) => object.key),
    ...folder.folders.flatMap(collectKeys),
  ];
}

function folderPaths(folder: CleanupTreeFolder): string[] {
  return [folder.path, ...folder.folders.flatMap(folderPaths)];
}

function SelectionBox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: ReactNode;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="s3-cleanup-tree__check">
      <input checked={checked} onChange={onChange} ref={ref} type="checkbox" />
      {label}
    </label>
  );
}

function CleanupFolderNode({
  folder,
  selectedKeys,
  expandedFolders,
  depth,
  onToggleFolder,
  onToggleSelection,
}: {
  folder: CleanupTreeFolder;
  selectedKeys: Set<string>;
  expandedFolders: Set<string>;
  depth: number;
  onToggleFolder: (path: string) => void;
  onToggleSelection: (keys: string[]) => void;
}) {
  const allKeys = collectKeys(folder);
  const selectedCount = allKeys.filter((key) => selectedKeys.has(key)).length;
  const expanded = expandedFolders.has(folder.path);
  return (
    <li className="s3-cleanup-tree__folder">
      <div className="s3-cleanup-tree__row" style={{ paddingLeft: `${depth * 20}px` }}>
        <button
          aria-expanded={expanded}
          className="s3-cleanup-tree__toggle"
          onClick={() => onToggleFolder(folder.path)}
          type="button"
        >
          <Icon name={expanded ? "chevron-down" : "chevron-right"} height="14" width="14" />
        </button>
        <SelectionBox
          checked={selectedCount === allKeys.length && allKeys.length > 0}
          indeterminate={selectedCount > 0 && selectedCount < allKeys.length}
          label={<><Icon name="folder" height="15" width="15" />{folder.name}<span className="s3-cleanup-tree__count">{allKeys.length}</span></>}
          onChange={() => onToggleSelection(allKeys)}
        />
      </div>
      {expanded ? (
        <ul className="s3-cleanup-tree__children">
          {folder.folders.map((child) => (
            <CleanupFolderNode
              expandedFolders={expandedFolders}
              folder={child}
              key={child.path}
              depth={depth + 1}
              onToggleFolder={onToggleFolder}
              onToggleSelection={onToggleSelection}
              selectedKeys={selectedKeys}
            />
          ))}
          {folder.objects.map((object) => (
            <li
              className="s3-cleanup-tree__file"
              key={object.key}
              style={{ paddingLeft: `${(depth + 1) * 20 + 26}px` }}
            >
              <SelectionBox
                checked={selectedKeys.has(object.key)}
                indeterminate={false}
                label={
                  <>
                    <Icon name="file" height="15" width="15" />
                    <span className="s3-cleanup-tree__file-name">{object.key.slice(object.key.lastIndexOf("/") + 1)}</span>
                    <span>{formatSize(object.size)}</span>
                    <span>{formatTimestamp(object.lastModified)}</span>
                  </>
                }
                onChange={() => onToggleSelection([object.key])}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function S3CleanupDialog({ profileId, bucket, prefix, onClose, onDelete }: Props) {
  const [cutoff, setCutoff] = useState(defaultCutoff);
  const [now, setNow] = useState(() => Date.now());
  const [objects, setObjects] = useState<S3CleanupObject[] | null>(null);
  const [totalSize, setTotalSize] = useState(0);
  const [exceededLimit, setExceededLimit] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const tree = useMemo(
    () => (objects ? buildTree(prefix, objects) : null),
    [objects, prefix],
  );
  const selectedObjects = objects?.filter((object) => selectedKeys.has(object.key)) ?? [];
  const selectedSize = selectedObjects.reduce((sum, object) => sum + object.size, 0);
  const canContinue = Boolean(objects?.length) && !exceededLimit && selectedKeys.size > 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function loadPreview() {
    const cutoffTimestamp = new Date(cutoff).getTime() / 1000;
    if (!Number.isFinite(cutoffTimestamp)) {
      setError("请输入有效的截止时间。");
      return;
    }
    setLoading(true);
    setError(null);
    setShowFinalConfirm(false);
    try {
      const preview = await previewS3Cleanup(profileId, bucket, prefix, Math.floor(cutoffTimestamp));
      setObjects(preview.objects);
      setTotalSize(preview.totalSize);
      setExceededLimit(preview.exceededLimit);
      setSelectedKeys(new Set(preview.objects.map((object) => object.key)));
      const nextTree = buildTree(prefix, preview.objects);
      setExpandedFolders(
        preview.objects.length <= 20 ? new Set(folderPaths(nextTree)) : new Set(),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取可清理文件。");
      setObjects(null);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(keys: string[]) {
    setSelectedKeys((current) => {
      const allSelected = keys.every((key) => current.has(key));
      const next = new Set(current);
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <>
      <div className="profile-editor-backdrop" role="presentation">
        <section className="s3-cleanup-dialog" aria-label="清理 S3 目录">
          <header className="profile-editor__topbar">
            <h2>清理目录</h2>
            <button className="icon-button" aria-label="关闭" onClick={onClose} type="button">
              <Icon name="close" />
            </button>
          </header>
          <div className="s3-cleanup-dialog__body">
            <p className="s3-cleanup-dialog__path">s3://{bucket}/{prefix}</p>
            <label className="field">
              <span>清理早于此时间的文件</span>
              <input
                onChange={(event) => setCutoff(event.currentTarget.value)}
                type="datetime-local"
                value={cutoff}
              />
              <span className="s3-cleanup-dialog__time-distance">
                {formatTimeDistance(cutoff, now)}
              </span>
            </label>
            <div className="s3-cleanup-dialog__actions">
              <Button
                className="s3-cleanup-dialog__find"
                disabled={loading}
                onClick={() => void loadPreview()}
                variant="primary"
              >
                {loading ? "正在查找..." : "查找文件"}
              </Button>
              {objects ? <span>{objects.length} 个文件，{formatSize(totalSize)}</span> : null}
            </div>
            {error ? <div className="form-errors">{error}</div> : null}
            {exceededLimit ? (
              <div className="form-errors">匹配文件超过 10,000 个。请缩小时间范围后再清理，避免遗漏预览内容。</div>
            ) : null}
            {objects && !exceededLimit ? (
              objects.length ? (
                <>
                  <div className="s3-cleanup-dialog__selection">
                    已选择 {selectedObjects.length} 个文件，{formatSize(selectedSize)}
                  </div>
                  {tree ? (
                    <ul className="s3-cleanup-tree">
                      <CleanupFolderNode
                        expandedFolders={expandedFolders}
                        folder={tree}
                        depth={0}
                        onToggleFolder={toggleFolder}
                        onToggleSelection={toggleSelection}
                        selectedKeys={selectedKeys}
                      />
                    </ul>
                  ) : null}
                </>
              ) : (
                <div className="s3-cleanup-dialog__empty">没有符合当前时间条件的文件。</div>
              )
            ) : null}
            <footer className="s3-dialog-actions">
              <Button onClick={onClose} variant="secondary">取消</Button>
              <Button
                className="s3-cleanup-dialog__continue s3-delete-dialog__confirm"
                disabled={!canContinue}
                onClick={() => setShowFinalConfirm(true)}
                variant="primary"
              >
                继续删除
              </Button>
            </footer>
          </div>
        </section>
      </div>
      {showFinalConfirm ? (
        <S3CleanupFinalConfirmDialog
          itemCount={selectedObjects.length}
          onClose={() => setShowFinalConfirm(false)}
          onConfirm={async () => {
            await onDelete(Array.from(selectedKeys));
            onClose();
          }}
          totalSize={selectedSize}
        />
      ) : null}
    </>
  );
}

function S3CleanupFinalConfirmDialog({
  itemCount,
  totalSize,
  onClose,
  onConfirm,
}: {
  itemCount: number;
  totalSize: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "清理文件失败。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="profile-editor-backdrop s3-cleanup-confirm-backdrop" role="presentation">
      <section className="s3-delete-dialog" aria-label="确认清理 S3 文件">
        <header className="profile-editor__topbar">
          <h2>确认不可恢复删除</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="s3-delete-dialog__body">
          <p>将永久删除已选择的 {itemCount} 个文件（{formatSize(totalSize)}）。</p>
          <p className="s3-delete-dialog__warning">S3 删除后无法通过 dssh 恢复。请确认这些文件不再需要。</p>
          {error ? <div className="form-errors">{error}</div> : null}
          <footer className="s3-dialog-actions">
            <Button disabled={deleting} onClick={onClose} variant="secondary">返回检查</Button>
            <Button className="s3-delete-dialog__confirm" disabled={deleting} onClick={() => void confirm()} variant="primary">
              {deleting ? "删除中..." : "永久删除"}
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
