import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@playwright/test";

/** CI evidence stays with the test that produced it; local previews keep stable names. */
export function editorArtifact(name) {
  return process.env.CI ? test.info().outputPath(name) : join(process.platform === "win32" ? tmpdir() : "/tmp", name);
}
