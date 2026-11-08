import type { LocalFileEntry, LocalListing } from "../services/sftpService.ts";

export function nativeDropClientPoint(
  position: { x: number; y: number },
  physicalSize: { width: number; height: number },
  viewport: { width: number; height: number },
  nativeToPhysicalScale = 1,
) {
  if (
    ![
      position.x,
      position.y,
      physicalSize.width,
      physicalSize.height,
      viewport.width,
      viewport.height,
      nativeToPhysicalScale,
    ].every(Number.isFinite) ||
    nativeToPhysicalScale <= 0 ||
    physicalSize.width <= 0 ||
    physicalSize.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  return {
    x:
      (position.x * nativeToPhysicalScale * viewport.width) /
      physicalSize.width,
    y:
      (position.y * nativeToPhysicalScale * viewport.height) /
      physicalSize.height,
  };
}

function windowsPath(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}
function normalized(path: string) {
  return windowsPath(path)
    ? path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    : path.replace(/\/+$/, "");
}
function location(path: string) {
  const windows = windowsPath(path);
  if (path.includes("\0") || (!windows && !path.startsWith("/")))
    throw new Error("拖入的本机路径无效。");
  const trimmed = windows
    ? path.replace(/[\\/]+$/, "")
    : path.replace(/\/+$/, "");
  if (
    !trimmed ||
    /^[a-z]:$/i.test(trimmed) ||
    (trimmed.startsWith("\\\\") && trimmed.slice(2).split(/[\\/]/).length <= 2)
  )
    throw new Error("请拖入文件或文件夹，不能上传文件系统根目录。");
  const index = windows
    ? Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
    : trimmed.lastIndexOf("/");
  const name = trimmed.slice(index + 1);
  if (!name || name === "." || name === "..")
    throw new Error("拖入的文件名无效。");
  const parent =
    index === 0
      ? "/"
      : windows && index === 2
        ? trimmed.slice(0, 3)
        : trimmed.slice(0, index);
  return { parent, name, windows };
}

/** Resolve native absolute paths through Rust listings, never File.path in JS. */
export async function nativeUploadEntries(
  paths: string[],
  list: (parent: string) => Promise<LocalListing>,
): Promise<LocalFileEntry[]> {
  const listings = new Map<string, LocalListing>();
  const resolved = new Map<string, LocalFileEntry>();
  for (const path of paths) {
    const { parent, name, windows } = location(path);
    const key = normalized(parent);
    let listing = listings.get(key);
    if (!listing) {
      listing = await list(parent);
      listings.set(key, listing);
    }
    const entry = listing.entries.find((item) =>
      windows
        ? item.name.toLowerCase() === name.toLowerCase()
        : item.name === name,
    );
    if (!entry)
      throw new Error(`无法读取拖入的项目「${name}」，文件可能已移动或删除。`);
    resolved.set(normalized(entry.path), entry);
  }
  const entries = [...resolved.values()].filter(
    (entry, _index, all) =>
      !all.some(
        (parent) =>
          parent.isDir &&
          !parent.isSymlink &&
          normalized(entry.path).startsWith(`${normalized(parent.path)}/`),
      ),
  );
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name))
      throw new Error(
        `拖入的项目中存在同名「${entry.name}」，请分批上传以避免互相覆盖。`,
      );
    names.add(entry.name);
  }
  return entries;
}
