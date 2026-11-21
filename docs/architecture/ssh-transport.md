# SSH 传输与安全边界

从根 AGENTS.md 迁入的连接路径、验证和恢复说明（2026-11-21）。实现机制和常量在本文件及相关源码维护，根规则仅保留编码行为约束。改变外部行为前按 [OpenSpec 流程](../openspec-workflow.md)提出变更。

## 连接、主机身份与凭据

- SSH features acquire transports from `SshConnectionPool` (`ssh/connection_pool.rs`) using a non-secret connection key that includes profile version, authentication kind, and proxy route. Terminal PTY, SFTP subsystem, host tools / AI exec, and all forwarding modes open independent channels on the shared transport. Channel ownership and limits are explicit; do not bypass the pool with a new ad-hoc connection path.
- Every pooled transport holds the shared `Arc<HostKeyVerifier>` (`ssh/host_keys.rs`, `AppState.host_keys`). **Host keys are verified TOFU** — first use prompts (`ssh://hostkey-prompt` → `HostKeyPrompt` modal → `respond_host_key_prompt`), matches connect silently, a changed key is rejected (`ssh://hostkey-changed`). Never reintroduce an "accept any key" handler.
- SSH terminals auto-reconnect within a 30s grace window with exponential backoff (`ssh/session_manager.rs`, `SessionStatus::Reconnecting`, `cancel_reconnect`); a clean `exit` does not reconnect.
- The pool also performs single-flight transport recovery and emits `ssh://transport-status`; terminal panes still reconnect their shell channel separately. Real-host, low-`MaxSessions`, network-jitter, and cross-platform acceptance remains tracked in TODO.md.
- Never expose SSH passwords, private keys, passphrases, S3 secret keys, API keys, or updater signing keys to the frontend, logs, tests, or commits. Resolve saved credentials in Rust only (currently stored in SQLite; OS-keychain migration is a planned follow-up).
- Destructive or remote-command AI actions require an explicit user approval flow.
- Treat backend error payloads as user-facing errors: use the project `AppError` conventions and normalize Tauri rejections in the frontend service layer.

## 关联文档

- [终端输出与流控](terminal-output-flow-control.md)
- [助手后台会话](assistant-sessions.md)
- [待完成的真实环境验收与凭据存储演进](../../TODO.md)
