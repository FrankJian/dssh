import { defineConfig } from "vite";
import { env } from "node:process";
import react from "@vitejs/plugin-react";

const host = env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
  // Parallel QA servers must not replace the running desktop app's dependencies.
  cacheDir: mode.endsWith("-qa") ? `node_modules/.vite-${mode}` : "node_modules/.vite",
  plugins: [react()],
  // Dependencies reached from toolbox workers are discovered only on first run
  // unless they are pre-bundled. Avoid reloading the workbench mid-conversion.
  optimizeDeps: {
    ...(mode === "editor-qa" ? { entries: ["tests/editor/*.html"] } : {}),
    include: ["saxes", "smol-toml", "toml-eslint-parser", "sql-formatter", "bcryptjs", "node-forge", "zxcvbn",
      ...(mode === "editor-qa" ? ["monaco-editor", "@monaco-editor/react",
        "monaco-editor/editor/standalone/browser/standaloneServices.js",
        "monaco-editor/platform/hover/browser/hover.js"] : [])],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // Prepare the QA entry graphs before the first two browser workers race to load them.
    ...(mode === "editor-qa" ? { warmup: { clientFiles: ["./tests/editor/fixture.tsx", "./tests/editor/workbench.tsx"] } } : {}),
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
