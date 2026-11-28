import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ci = Boolean(process.env.CI);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: "./tests/editor",
  testMatch: "*.browser.spec.mjs",
  outputDir: ci ? "test-results/editor" : join(process.platform === "win32" ? tmpdir() : "/tmp", "dssh-editor-playwright"),
  fullyParallel: false,
  workers: ci ? 2 : 1,
  forbidOnly: ci,
  globalTimeout: 15 * 60_000,
  reporter: ci ? [["line"], ["json", { outputFile: "test-results/editor-results.json" }]] : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:1435",
    launchOptions: !ci && existsSync(chrome) ? { executablePath: chrome } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "pnpm exec vite --mode editor-qa --host 127.0.0.1 --port 1435",
    url: "http://127.0.0.1:1435/tests/editor/index.html",
    reuseExistingServer: false,
  },
});
