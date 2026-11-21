# 远程 Explorer 增强规格

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 6. 验证要求

- 每个阶段均在 macOS、Windows 及至少一台真实 SSH/SFTP 主机验证。
- 覆盖权限拒绝、同名冲突、网络中断、符号链接、非 UTF-8 文件名（若服务器支持）和并发打开编辑器的场景。
- 前端运行 `pnpm exec tsc --noEmit`、`pnpm build`；Rust 运行 `cargo fmt`、Clippy（`-D warnings`）和测试。
