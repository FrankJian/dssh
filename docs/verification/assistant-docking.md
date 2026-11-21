# AI 助手停靠布局

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 验证

`pnpm test:assistant-dock` 覆盖默认值、非法偏好、三方向 Grid 区域、底部侧栏全高、960px 起的尺寸约束、窄窗口恢复、关闭面板和无 chrome 布局。另运行双平台快捷键匹配回归、TypeScript 与生产构建。

使用真实 AppLayout / AiChat / 停靠设置组件的独立浏览器预览，模拟聊天和终端数据并隔离本地偏好：已核对三方向、深浅主题、960px / 720px 窄布局、键盘及指针拖动、模型长列表、设置联动、助手 / 主机工具切换，以及位置切换时草稿和终端输入状态保留。该预览不连接真实 SSH，不代表 macOS / Windows 原生 Tauri、真实分屏 / SFTP 的完整验收。
