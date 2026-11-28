import { defineConfig } from "@playwright/test";
import base from "./playwright.editor.config";

const ci = Boolean(process.env.CI);
// The full suite remains available; routine CI checks the shared critical paths.
export default defineConfig(base, {
  grep: /@smoke/,
  workers: 2,
  timeout: 20_000,
  globalTimeout: 3 * 60_000,
  maxFailures: 3,
  ...(ci ? {
    outputDir: "test-results/editor-smoke",
    reporter: [["line"], ["json", { outputFile: "test-results/editor-smoke-results.json" }]],
  } : {}),
});
