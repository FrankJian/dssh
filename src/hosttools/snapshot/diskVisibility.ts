import type { SnapshotDisk } from "../../models/serverSnapshot";

const VIRTUAL_FILESYSTEMS = new Set([
  "tmpfs", "devtmpfs", "ramfs", "proc", "procfs", "sysfs", "devfs", "devpts",
  "cgroup", "cgroup2", "pstore", "securityfs", "debugfs", "tracefs", "configfs",
  "hugetlbfs", "mqueue", "fusectl", "binfmt_misc", "bpf", "nsfs", "rpc_pipefs",
  "autofs", "overlay", "overlay2", "aufs", "squashfs", "efivarfs", "selinuxfs",
]);

/** Keep disk-backed and network storage; collapse virtual/engine-internal mounts. */
export function isStorageDisk(disk: SnapshotDisk): boolean {
  if (disk.total === undefined || disk.total <= 0) return false;
  // An SSH endpoint inside a container may expose only an overlay root.
  if (disk.mount === "/") return true;
  if (VIRTUAL_FILESYSTEMS.has(disk.filesystem.toLowerCase())) return false;
  // Named volumes may themselves be dedicated disks or network shares.
  if (/^\/var\/lib\/docker\/(?:overlay2|overlay|aufs|containers|buildkit)\//.test(disk.mount)
      || /^\/var\/lib\/containerd\/.*snapshot/.test(disk.mount)
      || /\/\.local\/share\/docker\/(?:overlay2|overlay|aufs|containers|buildkit)\//.test(disk.mount)) return false;
  return !["/etc/hosts", "/etc/hostname", "/etc/resolv.conf"].includes(disk.mount);
}
