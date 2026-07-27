import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  S3Bookmark,
  S3Bucket,
  S3CannedAcl,
  S3Object,
  S3ObjectListing,
  S3Profile,
} from "../models";
import {
  copyS3Object,
  createS3Bookmark,
  createS3Folder,
  deleteS3Bookmark,
  deleteS3CleanupObjects,
  deleteS3Object,
  downloadS3Prefix,
  downloadS3Object,
  getS3ObjectAcl,
  listS3Buckets,
  listS3Bookmarks,
  listS3Objects,
  moveS3Object,
  onS3TransferProgress,
  setS3ObjectAcl,
  uploadS3Object,
} from "../services/s3Service";
import { Icon, type IconName } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { CannedAclDialog } from "./CannedAclDialog";
import { S3CleanupDialog } from "./S3CleanupDialog";
import { DeleteS3ObjectsDialog } from "./DeleteS3ObjectsDialog";
import { OpenS3LocationDialog } from "./OpenS3LocationDialog";

interface Props {
  downloadConcurrency: number;
  profile: S3Profile | null;
  uploadConcurrency: number;
}

type SortKey = "name" | "size" | "modified" | "storageClass";
type SortDirection = "asc" | "desc";
type PublicAccessStatus = "public-read" | "not-public-read" | "unknown";

const ACL_CHECK_CONCURRENCY = 6;

interface SelectedEntry {
  key: string;
  isFolder: boolean;
}

interface QueuedUpload {
  execute: () => Promise<void>;
  reject: (reason: unknown) => void;
  resolve: () => void;
}

interface TransferProgress {
  operation: "upload" | "download";
  key: string;
  transferred: number;
  total: number | null;
}

function baseName(key: string) {
  const clean = key.replace(/\/$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1);
}

function publicAccessCacheKey(profileId: string, bucket: string, key: string) {
  return `${profileId}\u0000${bucket}\u0000${key}`;
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

function formatTimestamp(seconds?: number) {
  return seconds == null ? "—" : new Date(seconds * 1000).toLocaleString();
}

function PublicAccessCell({ status }: { status: PublicAccessStatus | undefined }) {
  const label =
    status === "public-read"
      ? "公开读取"
      : status === "not-public-read"
        ? "非公开读取"
        : status === "unknown"
          ? "未知"
          : "—";
  return (
    <span
      className={`s3-table__public${status ? ` s3-table__public--${status}` : ""}`}
      title={status === "unknown" ? "无法读取对象访问权限" : undefined}
    >
      {label}
    </span>
  );
}

function objectIcon(key: string): IconName {
  const extension = key.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(extension)) {
    return "fileImage";
  }
  if (["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"].includes(extension)) {
    return "fileArchive";
  }
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(extension)) {
    return "fileMusic";
  }
  if (["mp4", "mkv", "avi", "mov", "webm", "m4v"].includes(extension)) {
    return "fileVideo";
  }
  if (["xls", "xlsx", "csv", "tsv", "ods"].includes(extension)) {
    return "fileSpreadsheet";
  }
  if ([
    "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c", "cpp", "h",
    "html", "css", "json", "yaml", "yml", "xml", "toml", "sh", "bash", "sql",
  ].includes(extension)) {
    return "fileCode";
  }
  if (["txt", "md", "pdf", "doc", "docx", "rtf", "log"].includes(extension)) {
    return "fileText";
  }
  return "file";
}

function publicObjectUrl(profile: S3Profile, bucket: string, key: string) {
  const scheme = profile.useTls ? "https" : "http";
  const isDefaultPort =
    (profile.useTls && profile.port === 443) || (!profile.useTls && profile.port === 80);
  const authority = `${profile.host}${isDefaultPort ? "" : `:${profile.port}`}`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return profile.forcePathStyle
    ? `${scheme}://${authority}/${encodeURIComponent(bucket)}/${encodedKey}`
    : `${scheme}://${encodeURIComponent(bucket)}.${authority}/${encodedKey}`;
}

function s3ErrorMessage(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason);
  const normalized = message.toLowerCase();
  if (normalized.includes("accessdenied") || normalized.includes("access denied") || normalized.includes("forbidden") || normalized.includes("403")) {
    return "没有读取此存储桶或路径的权限。请确认 bucket policy、IAM 权限或对象 ACL。";
  }
  if (normalized.includes("nosuchbucket") || normalized.includes("not found") || normalized.includes("404")) {
    return "未找到该存储桶或路径。请检查名称和路径是否正确。";
  }
  return message || fallback;
}

function parseS3Location(location: string) {
  const normalized = location
    .trim()
    .replace(/^s3:\/\//i, "")
    .replace(/^\/+|\/+$/g, "");
  const [bucket, ...parts] = normalized.split("/");
  if (!bucket || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(bucket)) {
    throw new Error("请输入有效的存储桶名称或 bucket/path 路径。");
  }
  return { bucket, prefix: parts.length ? `${parts.join("/")}/` : "" };
}

export function S3ObjectBrowser({
  downloadConcurrency,
  profile,
  uploadConcurrency,
}: Props) {
  const [buckets, setBuckets] = useState<S3Bucket[]>([]);
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    key: string;
    isFolder: boolean;
    object?: S3Object;
  } | null>(null);
  const [aclObject, setAclObject] = useState<S3Object | null>(null);
  const [cleanupPrefix, setCleanupPrefix] = useState<string | null>(null);
  const [isOpenLocationDialogOpen, setIsOpenLocationDialogOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<S3Bookmark[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<Record<string, SelectedEntry>>({});
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<SelectedEntry[] | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [isCheckingPublicAccess, setIsCheckingPublicAccess] = useState(false);
  const [publicAccessStatuses, setPublicAccessStatuses] = useState<
    Record<string, PublicAccessStatus>
  >({});
  const panelRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [transferProgresses, setTransferProgresses] = useState<Record<string, TransferProgress>>(
    {},
  );
  const directoryCache = useRef(new Map<string, S3ObjectListing>());
  const uploadQueueRef = useRef<QueuedUpload[]>([]);
  const activeUploadsRef = useRef(0);
  const uploadConcurrencyRef = useRef(uploadConcurrency);
  uploadConcurrencyRef.current = uploadConcurrency;
  const selectedItems = Object.values(selectedEntries);
  const activeTransfers = Object.entries(transferProgresses);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  function publicAccessStatus(key: string): PublicAccessStatus | undefined {
    if (!profile) return undefined;
    return publicAccessStatuses[publicAccessCacheKey(profile.id, bucket, key)];
  }

  const showPublicAccessColumn =
    isCheckingPublicAccess || objects.some((object) => publicAccessStatus(object.key) !== undefined);

  const sortedBuckets = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...buckets].sort((left, right) => {
      if (sortKey === "modified") {
        return ((left.creationDate ?? 0) - (right.creationDate ?? 0)) * direction;
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true }) * direction;
    });
  }, [buckets, sortDirection, sortKey]);
  const sortedPrefixes = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...prefixes].sort(
      (left, right) =>
        baseName(left).localeCompare(baseName(right), undefined, { numeric: true }) * direction,
    );
  }, [prefixes, sortDirection]);
  const sortedObjects = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...objects]
      .filter((item) => item.key !== prefix)
      .sort((left, right) => {
        if (sortKey === "size") return (left.size - right.size) * direction;
        if (sortKey === "modified") {
          return ((left.lastModified ?? 0) - (right.lastModified ?? 0)) * direction;
        }
        const leftValue = sortKey === "storageClass"
          ? left.storageClass ?? "STANDARD"
          : baseName(left.key);
        const rightValue = sortKey === "storageClass"
          ? right.storageClass ?? "STANDARD"
          : baseName(right.key);
        return leftValue.localeCompare(rightValue, undefined, { numeric: true }) * direction;
      });
  }, [objects, prefix, sortDirection, sortKey]);
  const visibleEntries = useMemo<SelectedEntry[]>(
    () => [
      ...sortedPrefixes.map((key) => ({ key, isFolder: true })),
      ...sortedObjects.map((object) => ({ key: object.key, isFolder: false })),
    ],
    [sortedObjects, sortedPrefixes],
  );

  function directoryCacheKey(targetBucket: string, targetPrefix: string) {
    return `${targetBucket}\u0000${targetPrefix}`;
  }

  function showTemporaryNotice(message: string) {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 4000);
  }

  function processUploadQueue() {
    while (
      activeUploadsRef.current < uploadConcurrencyRef.current &&
      uploadQueueRef.current.length
    ) {
      const task = uploadQueueRef.current.shift();
      if (!task) break;
      activeUploadsRef.current += 1;
      setActiveUploadCount(activeUploadsRef.current);
      void task
        .execute()
        .then(task.resolve, task.reject)
        .finally(() => {
          activeUploadsRef.current -= 1;
          setActiveUploadCount(activeUploadsRef.current);
          processUploadQueue();
        });
    }
  }

  function enqueueUpload(execute: () => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      uploadQueueRef.current.push({ execute, reject, resolve });
      processUploadQueue();
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  async function checkPublicAccess() {
    if (!profile || !bucket || isCheckingPublicAccess) return;
    const targetProfile = profile;
    const targets = objects;
    if (!targets.length) return;

    setError(null);
    setNotice(null);
    setIsCheckingPublicAccess(true);
    let index = 0;
    const results: Record<string, PublicAccessStatus> = {};
    const workerCount = Math.min(ACL_CHECK_CONCURRENCY, targets.length);

    async function worker() {
      while (index < targets.length) {
        const object = targets[index];
        index += 1;
        if (!object) continue;
        const cacheKey = publicAccessCacheKey(targetProfile.id, bucket, object.key);
        try {
          const acl = await getS3ObjectAcl(targetProfile.id, bucket, object.key);
          results[cacheKey] =
            acl === "public-read" || acl === "public-read-write"
              ? "public-read"
              : "not-public-read";
        } catch {
          results[cacheKey] = "unknown";
        }
        setPublicAccessStatuses((current) => ({ ...current, [cacheKey]: results[cacheKey] }));
      }
    }

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      const unknownCount = Object.values(results).filter((status) => status === "unknown").length;
      showTemporaryNotice(
        unknownCount
          ? `已检查 ${targets.length} 个文件；${unknownCount} 个文件无法读取 ACL。`
          : `已检查 ${targets.length} 个文件的公开访问状态。`,
      );
    } finally {
      setIsCheckingPublicAccess(false);
    }
  }

  function selectEntry(
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    entry: SelectedEntry,
  ) {
    const additive = event.ctrlKey || event.metaKey;
    setSelectedEntries((current) => {
      if (event.shiftKey && selectionAnchorKey) {
        const anchorIndex = visibleEntries.findIndex((item) => item.key === selectionAnchorKey);
        const targetIndex = visibleEntries.findIndex((item) => item.key === entry.key);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [from, to] = [anchorIndex, targetIndex].sort((left, right) => left - right);
          const range = Object.fromEntries(
            visibleEntries.slice(from, to + 1).map((item) => [item.key, item]),
          );
          return additive ? { ...current, ...range } : range;
        }
      }
      if (!additive) {
        return { [entry.key]: entry };
      }
      if (current[entry.key]) {
        const next = { ...current };
        delete next[entry.key];
        return next;
      }
      return { ...current, [entry.key]: entry };
    });
    if (!event.shiftKey) {
      setSelectionAnchorKey(entry.key);
    }
  }

  function openEntryContextMenu(
    event: { clientX: number; clientY: number; preventDefault: () => void },
    entry: SelectedEntry,
    object?: S3Object,
  ) {
    event.preventDefault();
    if (!selectedEntries[entry.key]) {
      setSelectedEntries({ [entry.key]: entry });
      setSelectionAnchorKey(entry.key);
    }
    setMenu({
      x: event.clientX,
      y: event.clientY,
      key: entry.key,
      isFolder: entry.isFolder,
      object,
    });
  }

  const loadObjects = useCallback(async (
    targetBucket: string,
    targetPrefix: string,
    append = false,
    token?: string,
    force = false,
  ) => {
    if (!profile || !targetBucket) return;
    if (!append) {
      setSelectedEntries({});
      setSelectionAnchorKey(null);
    }
    const cacheKey = directoryCacheKey(targetBucket, targetPrefix);
    const cached = !append && !token && !force ? directoryCache.current.get(cacheKey) : undefined;
    if (cached) {
      setBucket(targetBucket);
      setPrefix(cached.prefix);
      setPrefixes(cached.folders);
      setObjects(cached.objects);
      setNextToken(cached.nextContinuationToken);
      setError(null);
      return { ok: true };
    }
    setIsLoading(true);
    setError(null);
    try {
      const listing = await listS3Objects({
        profileId: profile.id,
        bucket: targetBucket,
        prefix: targetPrefix,
        continuationToken: token,
      });
      setBucket(targetBucket);
      setPrefix(listing.prefix);
      setPrefixes((current) => append ? [...current, ...listing.folders] : listing.folders);
      setObjects((current) => append ? [...current, ...listing.objects] : listing.objects);
      setNextToken(listing.nextContinuationToken);
      if (!append && !token) {
        directoryCache.current.set(cacheKey, listing);
      }
    } catch (reason) {
      const message = s3ErrorMessage(reason, "读取对象失败。");
      setError(message);
      return { ok: false, message };
    } finally {
      setIsLoading(false);
    }
    return { ok: true };
  }, [profile]);

  const loadBuckets = useCallback(async () => {
    if (!profile) return;
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await listS3Buckets(profile.id);
      setBuckets(loaded);
      setBucket("");
      setPrefix("");
      setPrefixes([]);
      setObjects([]);
      setSelectedEntries({});
      setSelectionAnchorKey(null);
      if (
        profile.defaultBucket &&
        loaded.some((item) => item.name === profile.defaultBucket)
      ) {
        await loadObjects(profile.defaultBucket, "");
      }
    } catch (reason) {
      setError(s3ErrorMessage(reason, "读取存储桶失败。"));
    } finally {
      setIsLoading(false);
    }
  }, [loadObjects, profile]);

  const reloadBookmarks = useCallback(async () => {
    if (!profile) {
      setBookmarks([]);
      return;
    }
    try {
      setBookmarks(await listS3Bookmarks(profile.id));
    } catch (reason) {
      setError(s3ErrorMessage(reason, "读取常用路径失败。"));
    }
  }, [profile]);

  useEffect(() => {
    directoryCache.current.clear();
    setBuckets([]);
    setBucket("");
    setPrefix("");
    setObjects([]);
    setPrefixes([]);
    setTransferProgresses({});
    if (profile) void loadBuckets();
  }, [loadBuckets, profile]);

  useEffect(() => {
    void reloadBookmarks();
  }, [reloadBookmarks]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const margin = 8;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(margin, Math.min(menu.x, window.innerWidth - rect.width - margin));
    const y = Math.max(margin, Math.min(menu.y, window.innerHeight - rect.height - margin));
    if (x !== menu.x || y !== menu.y) {
      setMenu((current) => (current ? { ...current, x, y } : null));
    }
  }, [menu]);

  useEffect(() => {
    if (!profile) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onS3TransferProgress((event) => {
      if (disposed || event.profileId !== profile.id) return;
      const transferId = `${event.operation}\u0000${event.bucket}\u0000${event.key}`;
      if (event.done) {
        setTransferProgresses((current) => {
          const next = { ...current };
          delete next[transferId];
          return next;
        });
      } else {
        setTransferProgresses((current) => ({
          ...current,
          [transferId]: {
            operation: event.operation,
            key: event.key,
            transferred: event.transferred,
            // A single PutObject request does not expose byte-level callbacks in
            // the AWS SDK. Render its initial stage as indeterminate instead of
            // showing a misleading 0% progress bar.
            total:
              event.operation === "upload" && event.transferred === 0
                ? null
                : event.total,
          },
        }));
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [profile]);

  async function run(operation: () => Promise<void>) {
    setIsBusy(true);
    setError(null);
    try {
      await operation();
      directoryCache.current.clear();
      if (bucket) await loadObjects(bucket, prefix);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "S3 操作失败。");
    } finally {
      setIsBusy(false);
    }
  }

  const uploadPaths = useCallback(async (paths: string[]) => {
    if (!profile || !bucket || paths.length === 0) return;
    setError(null);
    try {
      const results = await Promise.allSettled(paths.map((path) => {
        const name = path.split(/[\\/]/).pop() ?? "object";
        return enqueueUpload(() => uploadS3Object(
          profile.id,
          bucket,
          `${prefix}${name}`,
          path,
          profile.defaultAcl,
        ));
      }));
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) throw failed.reason;
      directoryCache.current.clear();
      await loadObjects(bucket, prefix);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传 S3 对象失败。");
    }
  }, [bucket, loadObjects, prefix, profile]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const insidePanel = (position: { x: number; y: number }) => {
      const element = panelRef.current;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = position.x / dpr;
      const y = position.y / dpr;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setIsDragOver(Boolean(profile && bucket && insidePanel(payload.position)));
      } else if (payload.type === "leave") {
        setIsDragOver(false);
      } else if (payload.type === "drop") {
        const inside = insidePanel(payload.position);
        setIsDragOver(false);
        if (inside && payload.paths.length) void uploadPaths(payload.paths);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [bucket, profile, uploadPaths]);

  async function handleUpload() {
    if (!profile || !bucket) return;
    const selection = await open({ multiple: true, title: "选择要上传的文件" });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    await uploadPaths(paths);
  }

  async function handleOpenLocation(location: string) {
    const target = parseS3Location(location);
    const result = await loadObjects(target.bucket, target.prefix);
    if (!result || !result.ok) {
      throw new Error(result?.message ?? "无法读取该 S3 路径。");
    }
  }

  async function handleSaveBookmark(location: string, name: string) {
    if (!profile) return;
    const target = parseS3Location(location);
    const defaultName = target.prefix
      ? `${target.bucket}/${target.prefix.replace(/\/$/, "")}`
      : target.bucket;
    await createS3Bookmark(profile.id, name.trim() || defaultName, target.bucket, target.prefix);
    await reloadBookmarks();
  }

  async function handleDeleteBookmark(id: string) {
    if (!profile) return;
    await deleteS3Bookmark(profile.id, id);
    await reloadBookmarks();
  }

  async function handleDownload(object: S3Object) {
    if (!profile) return;
    const destination = await save({ defaultPath: baseName(object.key) });
    if (!destination) return;
    await run(() => downloadS3Object(profile.id, bucket, object.key, destination));
  }

  async function copyPublicObjectUrl(object: S3Object) {
    try {
      await navigator.clipboard.writeText(publicObjectUrl(profile!, bucket, object.key));
      setNotice("对象 HTTP 地址已复制到剪贴板。");
    } catch {
      setError("无法复制对象 HTTP 地址。");
    }
  }

  async function handleDownloadFolder(folder: string) {
    if (!profile) return;
    const destination = await open({ directory: true, multiple: false, title: "选择下载目录" });
    if (!destination || Array.isArray(destination)) return;
    await run(async () => {
      await downloadS3Prefix(profile.id, bucket, folder, destination, downloadConcurrency);
    });
  }

  async function handleCreateFolder() {
    if (!profile || !bucket) return;
    const name = window.prompt("文件夹名称");
    if (!name?.trim()) return;
    const clean = name.trim().replace(/^\/+|\/+$/g, "");
    await run(() => createS3Folder(profile.id, bucket, `${prefix}${clean}/`));
  }

  async function confirmDeleteTargets() {
    if (!profile || !deleteTargets?.length) return;
    setIsBusy(true);
    setError(null);
    try {
      for (const target of deleteTargets) {
        await deleteS3Object(profile.id, bucket, target.key, target.isFolder);
      }
      directoryCache.current.clear();
      setSelectedEntries({});
      setSelectionAnchorKey(null);
      await loadObjects(bucket, prefix);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "删除 S3 对象失败。";
      setError(message);
      throw new Error(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmCleanup(keys: string[]) {
    if (!profile || !bucket || !cleanupPrefix) return;
    setIsBusy(true);
    setError(null);
    try {
      await deleteS3CleanupObjects(profile.id, bucket, cleanupPrefix, keys);
      directoryCache.current.clear();
      setPublicAccessStatuses({});
      setSelectedEntries({});
      setSelectionAnchorKey(null);
      await loadObjects(bucket, prefix);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "清理 S3 文件失败。";
      setError(message);
      throw new Error(message);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopyMove(key: string, isFolder: boolean, move: boolean) {
    if (!profile) return;
    const destination = window.prompt(
      move ? "移动到（格式：bucket/key）" : "复制到（格式：bucket/key）",
      `${bucket}/${key}`,
    );
    if (!destination) return;
    const slash = destination.indexOf("/");
    if (slash < 1 || slash === destination.length - 1) {
      setError("目标必须使用 bucket/key 格式。");
      return;
    }
    const destinationBucket = destination.slice(0, slash);
    const destinationKey = destination.slice(slash + 1);
    await run(async () => {
      if (move) {
        await moveS3Object(profile.id, bucket, key, destinationBucket, destinationKey, isFolder);
      } else {
        await copyS3Object(profile.id, bucket, key, destinationBucket, destinationKey, isFolder);
      }
    });
  }

  function parentPrefix() {
    const clean = prefix.replace(/\/$/, "");
    const slash = clean.lastIndexOf("/");
    return slash < 0 ? "" : clean.slice(0, slash + 1);
  }

  if (!profile) {
    return <section className="s3-browser s3-browser--empty"><Icon name="bucket" /><p>选择或新建一个 S3 配置以浏览对象。</p></section>;
  }

  return (
    <section
      className={`s3-browser${isDragOver ? " is-drag-over" : ""}`}
      aria-label="S3 对象浏览器"
      ref={panelRef}
    >
      {isDragOver ? <div className="s3-browser__dropzone">松开鼠标上传到当前前缀</div> : null}
      <header className="s3-browser__toolbar">
        <div className="s3-browser__actions">
          <IconButton
            disabled={!bucket || !objects.length || isCheckingPublicAccess}
            label="检查当前文件的公开访问状态"
            onClick={() => void checkPublicAccess()}
          >
            <Icon name="shield" />
          </IconButton>
          <IconButton disabled={isBusy || isLoading} label="刷新" onClick={() => bucket ? void loadObjects(bucket, prefix, false, undefined, true) : void loadBuckets()}><Icon name="refresh" /></IconButton>
          <IconButton disabled={isBusy || isLoading} label="打开 S3 路径" onClick={() => setIsOpenLocationDialogOpen(true)}><Icon name="folder" /></IconButton>
          <IconButton disabled={!bucket || isBusy} label="新建文件夹" onClick={() => void handleCreateFolder()}><Icon name="folderPlus" /></IconButton>
          <IconButton disabled={!bucket} label="上传" onClick={() => void handleUpload()}><Icon name="upload" /></IconButton>
          <IconButton disabled={!selectedItems.length || isBusy} label={`删除选中项目（${selectedItems.length}）`} onClick={() => setDeleteTargets(selectedItems)}><Icon name="trash" /></IconButton>
        </div>
      </header>
      <div className="s3-browser__path">
        <button className="s3-crumb" onClick={() => { setBucket(""); setPrefix(""); setObjects([]); setPrefixes([]); setSelectedEntries({}); setSelectionAnchorKey(null); }} type="button">存储桶</button>
        {bucket ? <><span>/</span><button className="s3-crumb" onClick={() => void loadObjects(bucket, "")} type="button">{bucket}</button></> : null}
        {prefix.split("/").filter(Boolean).map((part, index, parts) => {
          const target = `${parts.slice(0, index + 1).join("/")}/`;
          return <span className="s3-crumb-wrap" key={target}><span>/</span><button className="s3-crumb" onClick={() => void loadObjects(bucket, target)} type="button">{part}</button></span>;
        })}
      </div>
      {error ? <div className="s3-browser__error">{error}</div> : null}
      {notice ? <div className="s3-browser__notice">{notice}</div> : null}
      {activeTransfers.map(([transferId, progress]) => (
        <div className="s3-browser__transfer" key={transferId}>
          <div>
            {progress.operation === "upload" ? "上传" : "下载"}：{baseName(progress.key)}
            {!progress.total ? "（正在传输）" : ""}
          </div>
          <progress
            max={progress.total ?? undefined}
            value={progress.total ? progress.transferred : undefined}
          />
          <span>
            {progress.total
              ? `${formatSize(progress.transferred)} / ${formatSize(progress.total)}`
              : "正在传输…"}
          </span>
        </div>
      ))}
      <div className={`s3-table${showPublicAccessColumn ? " s3-table--with-public-access" : ""}`} role="table">
        <div className="s3-table__head" role="row">
          {([
            ["name", "名称"],
            ["size", "大小"],
            ["modified", "修改时间"],
            ["storageClass", "存储类别"],
          ] as const).map(([key, label]) => {
            const active = sortKey === key;
            return (
              <button
                aria-label={`按${label}排序`}
                className={`s3-table__sort${active ? " is-active" : ""}`}
                key={key}
                onClick={() => toggleSort(key)}
                type="button"
              >
                {label}
                {active ? (
                  <Icon
                    className={sortDirection === "desc" ? "is-desc" : ""}
                    name="arrowUp"
                    height="12"
                    width="12"
                  />
                ) : null}
              </button>
            );
          })}
          {showPublicAccessColumn ? <span className="s3-table__public-head">公开读取</span> : null}
        </div>
        {isLoading && !objects.length && !prefixes.length ? <div className="s3-table__empty">正在加载...</div> : !bucket ? (
          sortedBuckets.length ? sortedBuckets.map((item) => (
            <button
              className="s3-table__row"
              key={item.name}
              onDoubleClick={() => void loadObjects(item.name, "")}
              type="button"
            >
              <span className="s3-table__name"><Icon name="bucket" />{item.name}</span><span>—</span><span>{formatTimestamp(item.creationDate)}</span><span>存储桶</span>{showPublicAccessColumn ? <span>—</span> : null}
            </button>
          )) : <div className="s3-table__empty">没有存储桶。</div>
        ) : (
          <>
            {prefix ? <button className="s3-table__row" onDoubleClick={() => void loadObjects(bucket, parentPrefix())} type="button"><span className="s3-table__name"><Icon name="folder" />..</span><span>—</span><span>—</span><span>文件夹</span>{showPublicAccessColumn ? <span>—</span> : null}</button> : null}
            {sortedPrefixes.map((item) => (
              <button
                aria-selected={Boolean(selectedEntries[item])}
                className={`s3-table__row${selectedEntries[item] ? " is-selected" : ""}`}
                key={item}
                onClick={(event) => selectEntry(event, { key: item, isFolder: true })}
                onContextMenu={(event) => openEntryContextMenu(event, { key: item, isFolder: true })}
                onDoubleClick={() => void loadObjects(bucket, item)}
                type="button"
              >
                <span className="s3-table__name"><Icon name="folder" />{baseName(item)}</span><span>—</span><span>—</span><span>文件夹</span>{showPublicAccessColumn ? <span>—</span> : null}
              </button>
            ))}
            {sortedObjects.map((object) => (
              <button
                aria-selected={Boolean(selectedEntries[object.key])}
                className={`s3-table__row${selectedEntries[object.key] ? " is-selected" : ""}`}
                key={object.key}
                onClick={(event) => selectEntry(event, { key: object.key, isFolder: false })}
                onContextMenu={(event) => openEntryContextMenu(event, { key: object.key, isFolder: false }, object)}
                onDoubleClick={() => void handleDownload(object)}
                type="button"
              >
                <span className="s3-table__name"><Icon name={objectIcon(object.key)} />{baseName(object.key)}</span><span>{formatSize(object.size)}</span><span>{formatTimestamp(object.lastModified)}</span><span>{object.storageClass ?? "STANDARD"}</span>{showPublicAccessColumn ? <PublicAccessCell status={publicAccessStatus(object.key)} /> : null}
              </button>
            ))}
            {!prefixes.length && !sortedObjects.length ? <div className="s3-table__empty">此前缀下没有对象。</div> : null}
          </>
        )}
      </div>
      {nextToken ? <button className="s3-load-more" disabled={isLoading} onClick={() => void loadObjects(bucket, prefix, true, nextToken)} type="button">加载更多</button> : null}
      {isBusy ? <div className="s3-browser__status">正在执行操作...</div> : null}
      {activeUploadCount ? <div className="s3-browser__status">正在上传 {activeUploadCount} 个文件{uploadQueueRef.current.length ? `，${uploadQueueRef.current.length} 个等待中` : ""}...</div> : null}
      {menu ? (
        <div className="context-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()} role="menu">
          <button className="context-menu__item" onClick={() => { const target = menu; setMenu(null); if (target.isFolder) void handleDownloadFolder(target.key); else if (target.object) void handleDownload(target.object); }} type="button"><Icon name="download" />{menu.isFolder ? "递归下载" : "下载"}</button>
          {menu.isFolder ? <button className="context-menu__item" onClick={() => { setCleanupPrefix(menu.key); setMenu(null); }} type="button"><Icon name="trash" />清理此目录</button> : null}
          <button className="context-menu__item" onClick={() => { void navigator.clipboard.writeText(`s3://${bucket}/${menu.key}`); setMenu(null); }} type="button"><Icon name="copy" />复制 S3 URI</button>
          {!menu.isFolder && menu.object ? <button className="context-menu__item" onClick={() => { const target = menu.object; setMenu(null); if (target) void copyPublicObjectUrl(target); }} type="button"><Icon name="externalWindow" />复制公开 HTTP 地址</button> : null}
          <button className="context-menu__item" onClick={() => { const target = menu; setMenu(null); void handleCopyMove(target.key, target.isFolder, false); }} type="button"><Icon name="copy" />复制到...</button>
          <button className="context-menu__item" onClick={() => { const target = menu; setMenu(null); void handleCopyMove(target.key, target.isFolder, true); }} type="button"><Icon name="forward" />移动到...</button>
          {!menu.isFolder && menu.object ? <button className="context-menu__item" onClick={() => { setAclObject(menu.object ?? null); setMenu(null); }} type="button"><Icon name="shield" />设置 ACL</button> : null}
          <button className="context-menu__item context-menu__item--danger" onClick={() => { const target = menu; setMenu(null); setDeleteTargets(selectedEntries[target.key] ? selectedItems : [{ key: target.key, isFolder: target.isFolder }]); }} type="button"><Icon name="trash" />删除</button>
        </div>
      ) : null}
      {aclObject ? (
        <CannedAclDialog
          objectKey={aclObject.key}
          onClose={() => setAclObject(null)}
          onLoadAcl={() => getS3ObjectAcl(profile.id, bucket, aclObject.key)}
          onSubmit={async (acl: S3CannedAcl) => {
            await setS3ObjectAcl(profile.id, bucket, aclObject.key, acl);
            setPublicAccessStatuses((current) => ({
              ...current,
              [publicAccessCacheKey(profile.id, bucket, aclObject.key)]:
                acl === "public-read" || acl === "public-read-write"
                  ? "public-read"
                  : "not-public-read",
            }));
          }}
        />
      ) : null}
      {cleanupPrefix ? (
        <S3CleanupDialog
          bucket={bucket}
          onClose={() => setCleanupPrefix(null)}
          onDelete={confirmCleanup}
          prefix={cleanupPrefix}
          profileId={profile.id}
        />
      ) : null}
      {isOpenLocationDialogOpen ? (
        <OpenS3LocationDialog
          bookmarks={bookmarks}
          onClose={() => setIsOpenLocationDialogOpen(false)}
          onDeleteBookmark={handleDeleteBookmark}
          onOpen={handleOpenLocation}
          onSaveBookmark={handleSaveBookmark}
        />
      ) : null}
      {deleteTargets ? (
        <DeleteS3ObjectsDialog
          folderCount={deleteTargets.filter((item) => item.isFolder).length}
          itemCount={deleteTargets.length}
          onClose={() => setDeleteTargets(null)}
          onConfirm={confirmDeleteTargets}
        />
      ) : null}
    </section>
  );
}
