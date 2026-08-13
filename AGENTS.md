# Duo SSH Agent Guide

## Project
- Duo SSH (internal package / repository name: `dssh`) is a Windows/macOS desktop SSH manager built with React 19 + TypeScript + Vite and Tauri 2 + Rust.
- Use `pnpm` for frontend work. Use stable Rust (edition 2024) inside `src-tauri/`.
- Keep changes focused; do not edit generated output such as `dist/` or `src-tauri/target/`.
- [`README.md`](README.md) is the user-facing overview; [`TODO.md`](TODO.md) tracks known gaps, deliberate deferrals, and their rationale — read TODO before starting anything sizable so you don't redo a decision that was already made.

## Architecture
- Frontend source lives in `src/`: `models/` define shared payload types, `services/` wrap Tauri `invoke`, hooks own state, and feature folders own UI.
- Rust source lives in `src-tauri/src/`: add DTOs in `models/`, commands in `commands/`, register commands in `lib.rs`, and keep business logic in feature managers/repositories (`ssh/`, `sftp/`, `forwarding/`, `hosttools/`, `s3/`, `ai/`, `storage/`, `workspace/`).
- Tauri payloads use camelCase. Update both Rust serde DTOs and TypeScript types/services when a command or event changes.
- Persist server-side data through the SQLite repository and numbered SQL migrations in `src-tauri/migrations/`; preserve compatibility for existing databases. Some frontend-only, per-machine state (recent connections, tab order, panel widths, zen/theme/terminal prefs, update proxy) is intentionally kept in `localStorage` rather than the DB.

## Layout & workspace
- The shell (`app/AppLayout.tsx`) is: **title bar → [activity rail | left sidebar | main column (top tab strip / content) | right dock]**. `app/App.tsx` wires it together.
- Left activities (`app/ActivityBar.tsx`, `ActivityId`): `sessions` (the active-session tree, `ssh/SessionTree.tsx`), `connections` (the full-page Session Manager hub, `ssh/SessionManager.tsx`), `s3`. The right dock (`RightPanelId`) toggles `assistant` (AI) or `hosttools` (`hosttools/HostToolsPanel.tsx`).
- The main surface is chosen in App: Connections → SessionManager; S3 → S3Workspace; split layout → `terminal/PaneGrid.tsx`; else a single terminal or an SFTP tab. `app/useWorkspace.ts` coordinates SFTP tabs, tab ordering, and which surface is active; terminals stay in `terminal/useTerminalSessions.ts`.
- The unified top strip is `app/WorkspaceTabStrip.tsx` (terminals + SFTP, drag to reorder, middle-click to close, detach to a native window). Terminal-wide actions that must survive splitting (the split buttons) live in the strip, not inside a pane — `PaneGrid` replaces `TerminalWorkspace` when split, so anything inside a single pane disappears once the user splits.
- Signature interaction: a session-tree node (a host) expands into New Terminal / SFTP / Port Forwarding / Terminal N / Disconnect. SFTP and forwards are opened per-node.
- Splits (`terminal/usePaneLayout.ts`) are per-terminal-window nested pane trees with a maximum of four leaves. A split is applied to the currently focused pane and may mix horizontal and vertical branches. A new pane inherits the host of the pane it was split from — never silently open a local shell from an SSH pane.
- Detached workspaces are coordinated by `workspace/DetachedWorkspaceManager`, `app/DetachedWorkspace.tsx`, and `workspace://detached-window-*` events. A detached terminal keeps the same Rust session IDs and moves the entire pane tree; closing the native child restores it to the parent, while closing the tab intentionally closes its sessions. Detached labels match `detached-*` and must remain covered by `src-tauri/capabilities/detached-workspace.json`; Tauri capability changes require a full app restart, not only Vite HMR.
- Command palette: `app/CommandPalette.tsx` (⌘K / Ctrl+K) is the home for quick actions; context-sensitive entries (split, reconnect, SFTP, port forward) appear only when they apply. Zen mode hides all chrome (Esc to exit).

## SSH connection paths & security
- SSH features acquire transports from `SshConnectionPool` (`ssh/connection_pool.rs`) using a non-secret connection key that includes profile version, authentication kind, and proxy route. Terminal PTY, SFTP subsystem, host tools / AI exec, and all forwarding modes open independent channels on the shared transport. Channel ownership and limits are explicit; do not bypass the pool with a new ad-hoc connection path.
- Every pooled transport holds the shared `Arc<HostKeyVerifier>` (`ssh/host_keys.rs`, `AppState.host_keys`). **Host keys are verified TOFU** — first use prompts (`ssh://hostkey-prompt` → `HostKeyPrompt` modal → `respond_host_key_prompt`), matches connect silently, a changed key is rejected (`ssh://hostkey-changed`). Never reintroduce an "accept any key" handler.
- SSH terminals auto-reconnect within a 30s grace window with exponential backoff (`ssh/session_manager.rs`, `SessionStatus::Reconnecting`, `cancel_reconnect`); a clean `exit` does not reconnect.
- The pool also performs single-flight transport recovery and emits `ssh://transport-status`; terminal panes still reconnect their shell channel separately. Real-host, low-`MaxSessions`, network-jitter, and cross-platform acceptance remains tracked in TODO.md.
- Never expose SSH passwords, private keys, passphrases, S3 secret keys, API keys, or updater signing keys to the frontend, logs, tests, or commits. Resolve saved credentials in Rust only (currently stored in SQLite; OS-keychain migration is a planned follow-up).
- Destructive or remote-command AI actions require an explicit user approval flow.
- Treat backend error payloads as user-facing errors: use the project `AppError` conventions and normalize Tauri rejections in the frontend service layer.

## UI conventions
- Visual identity is the **Graphite Glass** theme: cold graphite surfaces and fog-white text carry hierarchy; restrained ice blue is reserved for focus, selected state, links, and primary actions. All colors, spacing, radii, and metrics are semantic CSS variables in `src/theme/global.css` (dark default + light). Components reference tokens only — never literal colors. Glass classes may only be used on stable chrome and overlays; terminal, Monaco, and scroll-heavy file content stay unblurred. The terminal palette lives in `terminal/terminalTheme.ts`.
- Terminal selection colors are kept close to the terminal background on purpose: xterm's WebGL renderer bakes the cell background into the glyph texture, so a high-contrast selection visibly changes how the text is antialiased. Don't "brighten" them without re-checking that.
- Follow `.cursor/rules/design.mdc`: compact native IDE-style UI, minimal motion, no card/marketing styling.
- Use outlined icons through the existing `Icon` component (add new glyphs there); icon names should describe the glyph, not the feature that happens to use it.
- Keep controls accessible: meaningful labels, keyboard-safe interactions, visible disabled states, and confirmations for irreversible actions.

## Validation
- Frontend changes: run `pnpm exec tsc --noEmit`; use `pnpm build` for production-build validation.
- Rust changes: run `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` from `src-tauri/`. CI runs exactly these on macOS and Windows (`.github/workflows/ci.yml`) and treats clippy warnings as errors, so check locally before pushing.
- Prefer verifying UI changes in `pnpm tauri dev`. Add focused regression tests for storage, parsing, validation, and security-sensitive behavior when practical.
