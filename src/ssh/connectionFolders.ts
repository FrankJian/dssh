export interface FolderProfile { folder?: string }
export interface ConnectionFolderNode {
  name: string;
  path: string;
  count: number;
  children: ConnectionFolderNode[];
}

/** Virtual library paths, independent from local/remote filesystem paths. */
export function normalizeConnectionFolder(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").map((part) => part.trim()).filter(Boolean);
  if (new TextEncoder().encode(value).length > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || parts.length > 32 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("目录最多 32 层、1024 字节，不能包含控制字符、. 或 ..。");
  }
  return parts.join("/");
}

export function isInConnectionFolder(profile: FolderProfile, folder: string): boolean {
  const path = profile.folder ?? "";
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

export function buildConnectionFolders(profiles: FolderProfile[]): ConnectionFolderNode[] {
  const roots: ConnectionFolderNode[] = [];
  for (const profile of profiles) {
    if (!profile.folder) continue;
    let children = roots;
    let path = "";
    for (const name of profile.folder.split("/")) {
      path = path ? `${path}/${name}` : name;
      let node = children.find((item) => item.path === path);
      if (!node) { node = { name, path, count: 0, children: [] }; children.push(node); }
      node.count += 1;
      children = node.children;
    }
  }
  function sort(nodes: ConnectionFolderNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) sort(node.children);
  }
  sort(roots);
  return roots;
}

export function renamedConnectionFolderPath(path: string, newName: string): string {
  const name = newName.trim();
  if (!name || /[/\\]/.test(name)) throw new Error("请输入单层目录名称，不能包含 / 或 \\。");
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return normalizeConnectionFolder(parent ? `${parent}/${name}` : name);
}
