# 工程结构与工作区架构

从根 AGENTS.md 迁入的结构与实现定位说明（2026-11-21）。本文用于解释源码组织，不替代需求规格；行为调整先查 [需求索引](../requirements.md)，验证边界见 [验收记录](../verification/README.md)。

## 源码与持久化边界

- Frontend source lives in `src/`: `models/` define shared payload types, `services/` wrap Tauri `invoke`, hooks own state, and feature folders own UI.
- Rust source lives in `src-tauri/src/`: add DTOs in `models/`, commands in `commands/`, register commands in `lib.rs`, and keep business logic in feature managers/repositories (`ssh/`, `sftp/`, `forwarding/`, `hosttools/`, `s3/`, `ai/`, `storage/`, `workspace/`).
- Tauri payloads use camelCase. Update both Rust serde DTOs and TypeScript types/services when a command or event changes.
- Persist server-side data through the SQLite repository and numbered SQL migrations in `src-tauri/migrations/`; preserve compatibility for existing databases. Some frontend-only, per-machine state (recent connections, tab order, panel widths, zen/theme/terminal prefs, update proxy) is intentionally kept in `localStorage` rather than the DB.

## 工作区组成与生命周期

- The shell (`app/AppLayout.tsx`) is: **title bar → [activity rail | left sidebar | main column (top tab strip / content) | right dock]**. `app/App.tsx` wires it together.
- Left activities (`app/ActivityBar.tsx`, `ActivityId`): `sessions` (the active-session tree, `ssh/SessionTree.tsx`), `connections` (the full-page Session Manager hub, `ssh/SessionManager.tsx`), `s3`. The right dock (`RightPanelId`) toggles `assistant` (AI) or `hosttools` (`hosttools/HostToolsPanel.tsx`).
- The main surface is chosen in App: Connections → SessionManager; S3 → S3Workspace; split layout → `terminal/PaneGrid.tsx`; else a single terminal or an SFTP tab. `app/useWorkspace.ts` coordinates SFTP tabs, tab ordering, and which surface is active; terminals stay in `terminal/useTerminalSessions.ts`.
- The unified top strip is `app/WorkspaceTabStrip.tsx` (terminals + SFTP, drag to reorder, middle-click to close, detach to a native window). Terminal-wide actions that must survive splitting (the split buttons) live in the strip, not inside a pane — `PaneGrid` replaces `TerminalWorkspace` when split, so anything inside a single pane disappears once the user splits.
- Signature interaction: a session-tree node (a host) expands into New Terminal / SFTP / Port Forwarding / Terminal N / Disconnect. SFTP and forwards are opened per-node.
- Splits (`terminal/usePaneLayout.ts`) are per-terminal-window nested pane trees without a pane count limit. A split is applied to the currently focused pane and may mix horizontal and vertical branches. Same-direction panes divide that axis equally by default; splitting across the other axis preserves its proportions. A new pane inherits the host of the pane it was split from — never silently open a local shell from an SSH pane.
- Detached workspaces are coordinated by `workspace/DetachedWorkspaceManager`, `app/App.tsx`, and `workspace://detached-window-*` events. A detached terminal keeps the same Rust session IDs and moves the entire pane tree; the child uses the same complete workbench as the main window and owns its new tabs too. Closing a native window closes only its sessions (with running-command confirmation), and never restores tabs to another window. Detached labels match `detached-*` and must remain covered by `src-tauri/capabilities/detached-workspace.json`; Tauri capability changes require a full app restart, not only Vite HMR.
- Command palette: `app/CommandPalette.tsx` (⌘K / Ctrl+K) is the home for quick actions; context-sensitive entries (split, reconnect, SFTP, port forward) appear only when they apply. Zen mode hides all chrome (Esc to exit).

## 终端选区的渲染约束

- Terminal selection colors are kept close to the terminal background on purpose: xterm's WebGL renderer bakes the cell background into the glyph texture, so a high-contrast selection visibly changes how the text is antialiased. Don't "brighten" them without re-checking that.

## 关联文档

- [工作区布局与助手停靠契约](../../openspec/specs/workspace-layout/spec.md)
- [助手停靠实现](assistant-docking.md)
- [终端配色契约](../../openspec/specs/terminal-appearance/spec.md)
- [界面设计规范](../design.md)
- [未排期与未完成事项](../../TODO.md)
