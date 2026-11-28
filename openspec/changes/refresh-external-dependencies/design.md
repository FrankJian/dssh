## Context
基线为 38b41f1。项目使用 Node 24、pnpm、Rust、Tauri；FreeRDP 与 SDL_ttf 使用固定源码散列。最新版本通过 npm/crates.io 官方元数据及上游发行记录核对。

## Decisions
- npm 更新 latest 稳定标签并做实际编译；Rust 更新清单允许范围并审查跨 0.x/主版本的 API 变化。
- 安全/存储接口不作静默语义迁移；不能兼容的依赖保留可用维护版本并记录原因。凭据格式、数据库及远端命令批准保持。
- 原生 RDP 更新时下载官方 tag 归档计算 SHA-256，适配锚点必须严格匹配，执行原生自检；不跳过失败检查。
- CI 与本地最低 Rust 要求一起核对，不把仅在本机新编译器可通过的依赖交给旧 CI。

## Risks / Trade-offs
- 新编译器/编辑器及 AI/SSH API 兼容风险 → 类型检查、严格 Clippy、现有回归与模拟界面验证。
- OS 原生凭据、真实网络及 Windows worker 不能由本机测试替代 → 明确保留发布前实机验收边界。
