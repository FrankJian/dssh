# dssh 待办

> 本文件**只记录尚未完成的开发项与待验收项**。已完成的阶段记录见 [`tasks.md`](tasks.md)，
> 当前界面与机制约定见 [`spec.md`](spec.md)，架构规则见 [`AGENTS.md`](AGENTS.md)。
>
> 优先级：**P1 = 安全/架构优先**，**P2 = 体验与可靠性**，**P3 = 可选演进**。

## P1：安全与连接架构

### 1. 系统钥匙串迁移

- 将 SSH 密码、私钥口令、S3 Secret Access Key 与 AI API Key 从 SQLite 明文迁至 macOS Keychain / Windows Credential Manager。
- 引入 `keyring`、`zeroize` 与仅保存引用键的 `SecretStore`；实现可幂等、可回退的迁移流程。
- 迁移前创建加密备份；完整覆盖认证、导入导出与失败恢复测试，避免凭据丢失或无法连接。

### 2. SSH 共享连接多路复用池

- 让终端 PTY、SFTP、端口转发、主机工具与 AI 按主机复用同一条物理 SSH 连接、分别打开 channel。
- 建立连接注册表、节点路由、连接断开与重连后的资源恢复策略。
- 同时实现会话树的多跳“钻入（下一跳 / 跳板）”与“另存为连接”。
- 此项影响核心连接路径，必须以真实主机覆盖并发 channel、断线、重连、转发和 SFTP 回归后再合入。

## P2：可靠性与工作区体验

### 3. 远程 Explorer 真实环境回归

- 在 macOS、Windows 和至少一台真实 SFTP 服务上验证上传、下载、拖放、批量操作、移动、递归删除及权限编辑。
- 覆盖权限拒绝、同名冲突、网络中断、符号链接、深层目录、非 UTF-8 文件名与取消操作。
- 依据验证结果修正各 SFTP 服务实现差异；完整边界见 [`features/remote-explorer-enhancement.md`](features/remote-explorer-enhancement.md)。

### 4. Monaco 编辑器跨平台验收

- 在 macOS、Windows 的开发环境和打包 WebView 中验证 Monaco worker、中文输入法、查找替换、手动语言选择、⌘/Ctrl+S、深浅主题与屏幕阅读器基本操作。
- 验证多标签切换、保存/放弃关闭、图片与 Markdown 预览不回归。
- 规格与已实现边界见 [`features/monaco-editor-integration.md`](features/monaco-editor-integration.md)。

### 5. 通知中心与统一确认框

- 在现有 Toast 之上提供通知历史与未读状态。
- 将仍在使用的 `window.alert` / `window.confirm` 统一为应用内确认组件；破坏性操作必须保持显式、阻塞式确认。

### 6. 分屏增强

- 跨重启持久化每个标签的分屏布局，并支持将已有会话拖入指定面板。

## P3：可选演进

### 7. 标签独立窗口

- 将终端或 SFTP 标签拆出为独立 Tauri 窗口，并处理会话输出、关闭和恢复的跨窗口路由。

### 8. 终端外观增强

- 支持整窗对桌面透明（Tauri 透明窗口与 macOS vibrancy）。
- 支持按标签或按主机保存独立的终端壁纸与透明度设置。
- 评估为 GPU 渲染下的选中文字差异提供单独的 DOM 渲染策略。

### 9. S3 并入统一工作区标签条

- 将 S3 从独立 activity 的子标签迁入 `WorkspaceTabStrip`，与终端、SFTP 使用一致的标签生命周期与重排交互。

### 10. 国际化

- 提取当前硬编码中文文案，提供语言包与语言切换；优先覆盖中文和英文。

### 11. 最近使用记录跨设备持久化

- 若需要跨设备同步“最近连接”，增加 `last_used_at` 数据迁移并在启动会话时更新；当前 localStorage 方案继续作为默认本机体验。
