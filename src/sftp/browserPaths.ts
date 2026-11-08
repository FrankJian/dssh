/** Local paths follow the client OS; remote paths always follow SFTP syntax. */
export function isWindowsLocalPath(path: string): boolean {
  return /^[a-z]:/i.test(path) || path.startsWith("\\\\");
}
function windowsRoot(path: string): string | null {
  const value = path.replace(/\//g, "\\");
  for (const pattern of [
    /^(\\\\\?\\UNC\\[^\\]+\\[^\\]+)(?:\\|$)/i,
    /^(\\\\\?\\[a-z]:)(?:\\|$)/i,
    /^(\\\\\?\\Volume\{[^}]+\})(?:\\|$)/i,
    /^(\\\\(?![?.]\\)[^\\]+\\[^\\]+)(?:\\|$)/,
    /^([a-z]:)(?:\\|$)/i,
  ]) {
    const match = value.match(pattern);
    if (match) return `${match[1]}\\`;
  }
  return null;
}
export function localParent(path: string): string {
  if (isWindowsLocalPath(path)) {
    const value = path.replace(/\//g, "\\");
    const root = windowsRoot(value);
    if (!root) return value;
    const trimmed = value.replace(/\\+$/, "");
    if (trimmed.length <= root.length - 1) return root;
    const index = trimmed.lastIndexOf("\\");
    return index < root.length ? root : trimmed.slice(0, index);
  }
  if (!path) return "";
  const value = path.replace(/\/+$/, "");
  const index = value.lastIndexOf("/");
  return index <= 0 ? "/" : value.slice(0, index);
}
export function isLocalRoot(path: string): boolean {
  if (isWindowsLocalPath(path)) {
    const root = windowsRoot(path);
    return Boolean(
      root &&
        path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase() ===
          root.replace(/\\+$/, "").toLowerCase(),
    );
  }
  return /^\/+$/.test(path);
}
export function joinLocal(directory: string, name: string): string {
  if (isWindowsLocalPath(directory))
    return `${directory.replace(/\//g, "\\").replace(/\\+$/, "")}\\${name}`;
  return `${directory.replace(/\/+$/, "")}/${name}`;
}
/** A downloaded filename is one component, never an address or drive path. */
export function joinLocalChild(directory: string, name: string): string {
  if (!name || name === "." || name === ".." || /[\/\0]/.test(name))
    throw new Error("文件名不是有效的单个路径项目。");
  if (
    isWindowsLocalPath(directory) &&
    (/[\\<>:\"|?*]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\.|$)/i.test(
        name.normalize("NFKC"),
      ))
  )
    throw new Error(
      `文件名「${name}」不能安全地保存到 Windows，请先在服务器上重命名。`,
    );
  return joinLocal(directory, name);
}
export function isRemoteRoot(path: string): boolean {
  return /^\/+$/.test(path) || /^\/?[a-z]:\/$/i.test(path);
}
export function remoteParent(path: string): string {
  if (!path) return "/";
  if (isRemoteRoot(path)) return path;
  const value = path.replace(/\/+$/, "");
  const index = value.lastIndexOf("/");
  const parent = index <= 0 ? "/" : value.slice(0, index);
  return /^\/?[a-z]:$/i.test(parent) ? `${parent}/` : parent;
}
export function joinRemote(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, "")}/${name}`;
}
export function addressText(input: string): string {
  const value = input.trim();
  const result =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
      ? value.slice(1, -1)
      : value;
  if (result.includes("\0")) throw new Error("路径不能包含 NUL 字符。");
  return result;
}
function localFileUrl(value: string, windows: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("文件 URL 格式无效。");
  }
  if (
    url.protocol !== "file:" ||
    url.search ||
    url.hash ||
    /%2f/i.test(url.pathname) ||
    (windows && /%5c/i.test(url.pathname))
  )
    throw new Error("请输入完整文件路径或有效的 file:// URL。");
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    throw new Error("文件 URL 的编码无效。");
  }
  if (path.includes("\0")) throw new Error("路径不能包含 NUL 字符。");
  if (url.hostname && url.hostname.toLowerCase() !== "localhost") {
    if (!windows) throw new Error("请先挂载网络共享，再输入本机挂载路径。");
    return `\\\\${url.hostname}${path.replace(/\//g, "\\")}`;
  }
  return windows
    ? path.replace(/^\/([a-z]:)/i, "$1").replace(/\//g, "\\")
    : path;
}
export function localAddressNeedsHome(input: string): boolean {
  return /^(?:~$|~[\\/])/.test(addressText(input));
}
export function resolveLocalAddress(
  input: string,
  current: string,
  options: { windows: boolean; home?: string },
): string {
  const { windows, home } = options;
  let value = addressText(input);
  if (!value) return current;
  if (/^file:/i.test(value)) value = localFileUrl(value, windows);
  else if (/^[a-z][a-z\d+.-]*:\/\//i.test(value))
    throw new Error("地址栏只接受本机文件路径或 file:// URL。");
  if (value === "~" || (windows ? /^~[\\/]/ : /^~\//).test(value)) {
    if (!home) throw new Error("无法确定本机主目录。");
    const suffix = value.slice(1).replace(windows ? /^[\\/]+/ : /^\/+/, "");
    value = suffix ? joinLocal(home, suffix) : home;
  }
  if (windows) {
    value = value.replace(/\//g, "\\");
    if (/^[a-z]:$/i.test(value)) return `${value}\\`;
    if (/^[a-z]:/i.test(value)) {
      if (!/^[a-z]:\\/i.test(value))
        throw new Error("请使用完整盘符路径，例如 C:\\Users，而不是 C:Users。");
      return value;
    }
    if (value.startsWith("\\\\")) {
      if (!windowsRoot(value))
        throw new Error(
          "请输入完整的网络共享或盘符路径，例如 \\\\server\\share。",
        );
      return value;
    }
    const root = windowsRoot(current);
    if (!root) throw new Error("本机当前目录尚未就绪，请先选择主目录或磁盘。");
    if (value.startsWith("\\")) return `${root}${value.replace(/^\\+/, "")}`;
    return joinLocal(current, value);
  }
  if (value.startsWith("/")) return value;
  if (!current.startsWith("/"))
    throw new Error("本机当前目录尚未就绪，请先选择主目录。");
  return joinLocal(current, value);
}
export function resolveRemoteAddress(
  input: string,
  current: string,
  home?: string,
): string {
  const value = addressText(input);
  if (!value) return current;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value))
    throw new Error("远端地址栏请输入服务器上的 SFTP 路径。");
  if (value === "~" || value.startsWith("~/")) {
    if (!home) throw new Error("无法确定服务器主目录。");
    return value === "~" ? home : joinRemote(home, value.slice(2));
  }
  if (value.startsWith("/") || /^[a-z]:\//i.test(value)) return value;
  if (!current) throw new Error("服务器当前目录尚未就绪。");
  return joinRemote(current, value);
}
export function fileNameKey(name: string, caseInsensitive: boolean): string {
  return caseInsensitive ? name.toLowerCase() : name;
}
export function navigationInputAfterFailure(
  input: string,
  submitted: string,
  confirmed: string,
): string {
  return input === submitted ? confirmed : input;
}
