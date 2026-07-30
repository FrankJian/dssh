# Duo SSH 待办

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

> 已完成：终端 PTY、SFTP subsystem、主机工具与 AI 单发 exec 会按有效连接配置复用一条 SSH
> transport，并持有各自独立的 channel。连接键包含 profile 版本、认证方式与代理路由，凭据不参与键或诊断。

- [ ] **2.8 回归与灰度验收**：全部端口转发类型现已接入共享 transport：本地 / 动态转发使用独立
  `direct-tcpip` channel，远程转发按远端监听地址与端口路由服务器回调。仍需在 macOS、Windows 与至少一台
  真实 SSH/SFTP 主机验证多终端 + SFTP + 主机工具 + AI 并发、低 `MaxSessions`、大文件传输、网络抖动、主机
  密钥首次信任 / 变更、认证失败、关闭顺序和所有转发类型。运行 `cargo fmt`、`cargo clippy --all-targets --
  -D warnings`、`cargo test`、前端 `pnpm exec tsc --noEmit` 与 `pnpm build`；通过后才将连接池标记为跨平台验收完成。

> 多跳“钻入（下一跳 / 跳板）”与“另存为连接”会改变 profile / 路由模型，应作为连接池完成后的独立任务，
> 不与本次 transport 重构捆绑交付。

### 3. SSH 多跳钻入与跳板连接

> 前置依赖：完成 2.2 连接池内核。目标是从已连接的堡垒机 / 上游主机，经 SSH `direct-tcpip`
> 通道建立到内网目标机的**第二次 SSH 握手**；它不是现有 HTTP / SOCKS 代理字段的别名。每一跳的
> 认证、主机密钥与生命周期必须独立，且始终在 Rust 侧处理。

- [ ] **3.1 路由与持久化模型**：定义临时 `JumpRoute` / `HopDescriptor` 与已保存连接的跳板引用模型；
  区分“直接连接”“HTTP / SOCKS 代理”“SSH 跳板”，并为 profile 引用、改名、删除和失效跳板设计兼容
  迁移与可读错误。保存目标连接时只保存到上游 profile 的引用，绝不复制或下发上游密钥、密码、口令。
- [ ] **3.2 上游通道与下游握手**：在上游 transport 上申请 `direct-tcpip` 到目标 `host:port`，使下游
  SSH 客户端通过该字节流完成密钥协商和认证；验证 `russh` 对自定义 stream 的接入方式，必要时封装适配层。
  上游连接未就绪、目标不可达、目标认证失败和 channel 限额必须分别返回可定位错误。
- [ ] **3.3 双层 TOFU 与认证流程**：上游和下游主机分别按真实 `host:port` 校验主机密钥；首次信任和密钥
  变更提示必须显示完整路径（例如“经 bastion → 10.0.2.15”），不得把上游已信任错误当成下游已信任。
  下游认证复用既有密码 / 私钥安全边界，且不得隐式转发 agent 或复用不属于目标主机的凭据。
- [ ] **3.4 会话树与临时钻入交互**：在活动会话节点提供“钻入下一跳”动作，输入目标地址、端口、用户名和
  认证方式后创建临时子节点；子节点显示上游链路、独立连接状态与终端数，支持返回上游、关闭当前跳点和
  错误重试。保持现有直接连接、SFTP 与标签交互不变。
- [ ] **3.5 下游工作区能力接入**：让经跳板建立的目标会话支持终端 / pane、SFTP Explorer、主机工具与 AI
  exec；多跳场景的端口转发仅在 2.8 的共享 transport 真实环境验收通过后接入。所有功能都应路由到下游目标，而不能在上游
  shell 中拼接 `ssh` 命令来模拟钻入。
- [ ] **3.6 另存为连接**：将临时目标转换为可编辑的 SSH profile：保存目标自身的认证材料、跳板 profile
  引用、显示名称、标签和描述；处理同名、跳板删除 / 修改、导入导出与脱敏展示。保存失败不得影响已打开的
  临时会话。
- [ ] **3.7 链路恢复与关闭语义**：上游 transport 断开时，所有下游节点按依赖顺序进入重连或失败状态；上游
  恢复后重建每一跳的 transport / channel，下游终端明确以新 shell 恢复。关闭子节点只释放其资源；关闭
  上游节点则有明确的级联确认与资源回收。
- [ ] **3.8 真实环境验收**：使用至少“本机 → 堡垒机 → 内网目标机”的两跳环境覆盖密码与私钥认证、首次
  信任 / 密钥变更、目标不可达、上游断线、并发终端 + SFTP、保存 / 编辑 / 删除跳板引用，以及 macOS / Windows
  UI。运行 `cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test`、`pnpm exec tsc --noEmit` 与
  `pnpm build` 后才将多跳能力标记为可发布。

## P2：可靠性与工作区体验

### 4. 远程工作区跨平台验收

- 在 macOS、Windows 的开发环境与打包 WebView 中验证远程 Explorer、Monaco、SFTP 双栏和标签独立窗口的组合行为。
- 覆盖 Monaco worker / 中文输入法 / 主题切换、远程文件拖放与批量操作、独立终端输入 / 关闭 / 合并、独立 SFTP 上传下载，以及窗口关闭顺序。
- 使用至少一台真实 SSH/SFTP 主机覆盖权限拒绝、符号链接、非 UTF-8 文件名、网络中断和大文件传输；规格边界见 [`features/monaco-editor-integration.md`](features/monaco-editor-integration.md) 与 [`features/remote-explorer-enhancement.md`](features/remote-explorer-enhancement.md)。

### 5. 通知中心与统一确认框

- 在现有 Toast 之上提供通知历史与未读状态。
- 将仍在使用的 `window.alert` / `window.confirm` 统一为应用内确认组件；破坏性操作必须保持显式、阻塞式确认。

## P3：可选演进

### 6. 终端外观增强

- 支持整窗对桌面透明（Tauri 透明窗口与 macOS vibrancy）。
- 支持按标签或按主机保存独立的终端壁纸与透明度设置。
- 评估为 GPU 渲染下的选中文字差异提供单独的 DOM 渲染策略。

### 7. S3 并入统一工作区标签条

- 将 S3 从独立 activity 的子标签迁入 `WorkspaceTabStrip`，与终端、SFTP 使用一致的标签生命周期与重排交互。

### 8. 国际化

- 提取当前硬编码中文文案，提供语言包与语言切换；优先覆盖中文和英文。

### 9. 最近使用记录跨设备持久化

- 若需要跨设备同步“最近连接”，增加 `last_used_at` 数据迁移并在启动会话时更新；当前 localStorage 方案继续作为默认本机体验。
