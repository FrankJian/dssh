# AI 后台交互会话

> 当前行为契约：[assistant-sessions](../../openspec/specs/assistant-sessions/spec.md)。本文用于使用或实现说明，不另行扩展行为承诺。

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 实现位置

- `src-tauri/src/ai/background.rs`：后台创建 / 复用、就绪等待、取消清理与工具结果。
- `src-tauri/src/ssh/session_manager.rs`：归属、真实状态、事件隔离、接管、回收、输入并发控制。
- `src-tauri/src/commands/ai.rs`：后台列表、接管、关闭、对话回收命令。
- `src/ai/AiBackgroundSessions.tsx`：轻量后台列表；`useAiChat.ts`：对话标识与清理。
- `src/terminal/useTerminalSessions.ts`：附着原终端、回放输出、恢复目标与运行状态。
