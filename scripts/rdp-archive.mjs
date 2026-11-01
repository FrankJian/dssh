import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

export function archiveExtractor(platform, systemRoot) {
  if (platform !== "win32") return "tar";
  if (!systemRoot) throw new Error("SystemRoot is required to locate the Windows tar.exe.");
  // Git Bash can put GNU tar before Windows' native bsdtar on PATH.
  return win32.join(systemRoot, "System32", "tar.exe");
}

export function extractArchive(archive, destination, {
  platform = process.platform,
  systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.windir,
  execute = execFileSync,
} = {}) {
  // GNU tar treats a drive-prefixed archive (D:\...) as a remote host spec.
  // Reading the archive on stdin also handles custom paths with spaces/colons.
  execute(archiveExtractor(platform, systemRoot), ["-xzf", "-", "-C", destination], {
    input: readFileSync(archive),
    stdio: ["pipe", "inherit", "inherit"],
  });
}
