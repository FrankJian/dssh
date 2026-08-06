# Duo SSH 待办

> 本文件**只记录尚未完成的开发项与待验收项**。已进入实施拆分的任务见 [`tasks.md`](tasks.md)，
> 当前界面与机制约定见 [`spec.md`](spec.md)，架构规则见 [`AGENTS.md`](AGENTS.md)。
>
> 优先级：**P1 = 安全/架构优先**，**P2 = 体验与可靠性**，**P3 = 可选演进**。

## P1：安全与连接架构

### 1. 系统钥匙串迁移

- 将 SSH 密码、私钥口令、S3 Secret Access Key 与 AI API Key 从 SQLite 明文迁至 macOS Keychain / Windows Credential Manager。
- 引入 `keyring`、`zeroize` 与仅保存引用键的 `SecretStore`；实现可幂等、可回退的迁移流程。
- 迁移前创建加密备份；完整覆盖认证、导入导出与失败恢复测试，避免凭据丢失或无法连接。



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

### 4. 终端吞吐、生命周期与显示保真

- 终端输出目前每个 SSH 数据包 emit 一次事件且广播到所有窗口，前端缓冲用字符串拼接，切标签会销毁并重建
  xterm 实例并重放被截断的 backlog（后者同时是性能问题和 alt screen 画面错乱的正确性问题）。需要按
  基线 → 输出合并 → 缓冲与反压 → 实例常驻 → 定向投递的顺序推进，并补上 Windows ConPTY 提示与字符宽度
  修正。完整审计与指标门槛见 [`features/terminal-performance.md`](features/terminal-performance.md)，
  分阶段实施清单见 [`tasks.md`](tasks.md#终端吞吐生命周期与显示保真)。

### 5. 通知中心与统一确认框

- 在现有 Toast 之上提供通知历史与未读状态。
- 将仍在使用的 `window.alert` / `window.confirm` 统一为应用内确认组件；破坏性操作必须保持显式、阻塞式确认。

## P3：可选演进



### 7. S3 并入统一工作区标签条

- 将 S3 从独立 activity 的子标签迁入 `WorkspaceTabStrip`，与终端、SFTP 使用一致的标签生命周期与重排交互。

### 8. 液态玻璃（窗口材质与半透明外观）

- 在设置 → 外观提供“关闭 / 仅浮层 / 整窗”三档窗口材质与三档强度，默认关闭。仅浮层档是纯 CSS
  `backdrop-filter`，跨平台无风险；整窗档需要窗口透明 + 系统材质（Windows 11 Mica / Acrylic、macOS
  vibrancy），会影响窗口缩放性能、resize 边框与启动首帧，必须先完成可行性验证。终端默认保持完全不透明，
  玻璃不得降低正文可读性。完整规格见 [`features/liquid-glass.md`](features/liquid-glass.md)，分阶段实施清单见
  [`tasks.md`](tasks.md#液态玻璃窗口材质与半透明外观)。

### 9. VNC 远程桌面工作区

- 新增独立 VNC profile、嵌入式远程桌面工作区，以及通过既有 SSH connection pool 建立的 VNC 隧道。该功能必须
  让保存的 VNC 凭据停留在 Rust / 系统密钥链中，不能让 WebView 直接代理 TCP 或读取密码。完整协议、安全和界面
  规格见 [`features/vnc-workspace.md`](features/vnc-workspace.md)，分阶段实施清单见
  [`tasks.md`](tasks.md#vnc-远程桌面工作区)。
