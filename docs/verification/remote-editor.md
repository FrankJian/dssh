# Monaco 远程代码编辑器规格

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 7. 验收与验证

- 打开、切换、保存、放弃关闭多个远端文本文件；确认无内容丢失、无重复 model、无残留 worker 错误。
- Markdown / 图片继续走现有预览路径，目录树上传下载不回归。
- 在 macOS、Windows 的开发与打包环境验证 worker 加载、深浅主题、中文输入法、⌘/Ctrl+S、屏幕阅读器基本操作。
- 运行 `pnpm exec tsc --noEmit`、`pnpm build`；若改动 Tauri / SFTP 接口，补跑 Rust 全套验证。
