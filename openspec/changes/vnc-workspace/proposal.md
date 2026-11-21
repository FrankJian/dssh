# Proposal

## Why

原 `features/vnc-workspace.md` 已有独立 VNC viewer 方案与任务，但混在旧功能目录中，容易被误认为已实现。迁入 OpenSpec 后继续作为未实施需求管理，不改变首版门槛。

## What Changes

- 提供 Rust 认证/传输桥与 noVNC 渲染的 VNC 工作区，优先 SSH tunnel。
- 独立 profile、运行会话、系统凭据存储与生命周期，不把 VNC 密码交给 WebView。
- 分阶段支持日常交互、受限直连、TLS/身份验证与跨平台恢复验收。
- Phase 0–4 保持未完成；Phase 5 保持可选，不阻塞首版。此导入不执行任何实现任务。

## Capabilities

### New Capabilities

- `vnc-workspace`：VNC 连接、安全传输、viewer、输入/剪贴板权限和会话生命周期。

### Modified Capabilities

无。复用现有工作台、连接池与安全规则，不借文档导入改变已存在能力的要求。

## Impact

未来影响 Rust VNC manager/bridge、前端 viewer、独立 profile/迁移、SecretStore、capabilities、配置导入导出及两平台发布。完整原方案与验证门槛见 [design.md](design.md)，执行清单见 [tasks.md](tasks.md)。
