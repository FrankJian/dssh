# VNC 远程桌面工作区规格

> 状态：提案，已完成与当前架构及主流实现的可行性核对；尚未进入代码实现。本功能是嵌入式 VNC **查看器**，不是 VNC Server。实施任务见 [../tasks.md](../tasks.md#vnc-远程桌面工作区)，高层排期见 [../TODO.md](../TODO.md)。

## 1. 结论与技术决策

### 1.1 可行性结论

**可以支持**，但不能把 VNC 当作 SSH profile 增加几个字段。项目已经有四项关键基础：

- 连接管理器已有独立连接类型目录，并已以 Kubernetes 证明可用独立 profile / 工作区接入；
- 顶部工作区标签条、独立窗口和连接卡片可容纳非终端类工作区；
- Rust 后端可持久化配置、管理进程内会话，并统一向前端暴露 Tauri 命令；
- SSH 连接池已支持 direct-tcpip channel，VNC 可经现有 SSH profile 建立安全隧道，而无需启动外部 ssh 进程。

真正新增的核心是 VNC 的 RFB 协商、认证、会话桥接和屏幕渲染。WebView 不能直接打开 TCP socket；noVNC 只接受携带 RFB 字节流的 WebSocket，因此不可以让 React 直接连 VNC 的 5900 端口。

### 1.2 首选架构

采用 [@novnc/novnc](https://www.npmjs.com/package/%40novnc/novnc) 作为 WebView 中的成熟 RFB 渲染与输入层，采用 Rust 管理远端连接和一次性、本机回环的 WebSocket bridge。noVNC 已支持缩放、裁剪、远端尺寸调整、Unicode 剪贴板及常见 RFB encoding；TigerVNC 的安全、共享、只读、自动编码选择与 SSH gateway 能力可作为体验和安全基线。

架构如下：

~~~text
VncWorkspace (React + noVNC)
      │  ws://127.0.0.1:<ephemeral>/<one-time-capability>
      ▼
VncManager / LocalRfbBridge (Rust；仅回环、单次连接、短生命周期)
      ├─ 直接 TCP ───────────────────────────────────► VNC Server
      └─ SSH ConnectionPool direct-tcpip ────────────► VNC Server
                 （复用 TOFU、代理、channel 限额与恢复）
~~~

- bridge **不是**通用 WebSocket-to-TCP 转发器。它先在 Rust 侧完成远端 RFB 版本与安全协商，再向 noVNC 提供一条仅限本次会话的本地 RFB 流；这样保存的 VNC 密码不需要从 Rust 返回给前端。
- bridge 向 noVNC 提供本地 RFB 的 None 安全握手，随后透明转发已建立的 RFB 流量。它必须自己实现 / 复用经过审计的远端 RFB client handshake，不能只嵌入 websockify。
- 每个 capability 仅允许一个 WebSocket、仅监听 127.0.0.1 或 ::1、不可持久化、不可记录到日志，且在取消、连接失败、关闭标签或超时后立即失效。握手校验产品 WebView origin；开发模式仅允许受控 Vite origin。
- 前端只拿到短时 WebSocket 地址以装载画面；它从不拿到 VNC 密码、证书私钥、SSH 凭据或后端 SSH channel。
- 首版不打包 Python websockify 或外部 TigerVNC Viewer。前者是通用代理且增加运行时供应链，后者无法提供统一标签工作区、凭据边界和跨平台一致体验。

### 1.3 依赖与协议范围

- 前端固定使用经依赖、许可证与构建验证后的 @novnc/novnc 版本（当前调研为 1.7.0，MPL-2.0）；发布包和关于页保留 SPDX / LICENSE / NOTICE 要求。
- Rust 侧可新增异步 WebSocket、DES 和 TLS 依赖；不得把一个长期无人维护的 Rust VNC crate 直接作为唯一安全边界。Phase 0 必须通过最小 handshake spike 决定是小型自有协议层，还是可审计、跨 macOS / Windows 构建的库。
- 兼容 RFB 3.3、3.7、3.8 的标准协商与服务器能力差异。RFC 6143 要求客户端能回退到旧版 3.3 / 3.7；不把厂商私有版本号当作标准协议。
- MVP 只承诺标准 None 与经典 VNC Authentication，经 SSH 隧道使用。经典 VNC Authentication 是遗留认证，不能被视为加密传输。
- VeNCrypt TLS / X.509、Plain、RealVNC RSA-AES、Tight / UltraVNC 扩展、Repeater、音频、文件传输、多显示器与录制均不进入 MVP。noVNC 的广泛兼容性是后续扩展的参考，不是 Duo SSH 初版的自动承诺。

## 2. 目标与非目标

### 2.1 目标

- 在“连接管理”中新增独立 VNC 类型与编辑器；不污染 SshProfile，也不复制 SSH 凭据。
- 提供保存的直连 VNC profile，以及通过已保存 SSH profile 到达内网 VNC endpoint 的 SSH tunnel profile。
- 在统一顶部标签条中打开一个交互式 VNC 桌面：鼠标、键盘、缩放、裁剪、全屏、只读模式、显式的剪贴板同步和安全的断开 / 重连。
- 支持多个独立 VNC 标签；同一 profile 可以按配置共享或新建服务器会话。
- 复用 Violet / Nebula token、连接管理搜索 / 分组 / 收藏、最近连接、命令面板、Toast、独立窗口和错误规范化。
- 使 VNC 密码、TLS 客户端凭据和会话 capability 永不写入日志、前端持久化状态或普通 SQLite 字段。

### 2.2 非目标

- 不实现 VNC Server、屏幕共享被控端、云中继 / NAT 穿透或 RealVNC Connect 云账号。
- 不承诺替代 TigerVNC、RealVNC Viewer 或 Remmina 的全部厂商扩展与企业身份系统。
- 不把 VNC 放进终端 PaneGrid；VNC 不支持终端分屏、新建 shell、SFTP、端口转发、主机工具或 SSH AI exec。
- 不支持未加密直连上的静默保存密码、自动重连或默认剪贴板同步。
- 不支持 RFB 非标准文件传输、远端音频、录屏、打印、USB 重定向或多显示器管理；这些能力没有统一、可安全互操作的 RFB 基线。
- 不导入任意 .vnc、.tigervnc 或厂商配置文件作为首版范围。后续导入必须先做格式、秘密字段和安全策略专项设计。

## 3. 连接模型、持久化与安全

### 3.1 VNC profile

VNC 使用独立表、独立 DTO 和独立 hook；连接管理器在渲染层聚合 SSH、Kubernetes 与 VNC 卡片。建议模型：

~~~ts
type VncTransport =
  | { kind: "sshTunnel"; sshProfileId: string; targetHost: string; targetPort: number }
  | { kind: "directTcp"; host: string; port: number; insecureDirectAcknowledged: boolean };

type VncAuthentication =
  | { kind: "none" }
  | { kind: "vncPassword"; hasPassword: boolean };

interface VncProfile {
  id: string;
  name: string;
  transport: VncTransport;
  authentication: VncAuthentication;
  shared: boolean;
  defaultViewOnly: boolean;
  favorite: boolean;
  tags: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}
~~~

- 首版统一要求明确的 host 与 1–65535 port，默认端口为 5900；不接受含糊的 host:display 或 host::port 单文本解析。编辑器可在后续提供 display number 辅助输入，但保存时必须归一化为端口。
- SSH tunnel 保存的是 SSH profile ID 与**从网关视角解析**的 target host / port。SSH profile 改名不影响引用；删除时 VNC profile 进入“隧道来源失效”，可修复但不能级联删除。
- direct TCP 是例外路径：在保存与每次连接时均显示 VNC Authentication 不提供传输加密的警示；用户必须显式确认可信内网 / 已有外层 VPN。首版默认建议、并在快捷入口优先使用 SSH tunnel。
- VNC 密码只通过创建 / 更新请求进入 Rust，并保存为独立 secret reference。读取 profile 时只返回 hasPassword；更新时空值表示保持旧密码，显式“清除密码”才删除引用。
- VNC 新增 profile 不能以项目当前普通 app_secrets 表作为最终凭据仓库。Phase 0 的发布门禁是接入 TODO 所列系统密钥链 SecretStore；安全存储不可用时禁用“保存密码”，允许用户在每次连接的本地瞬时提示中输入，且该输入在连接结束后归零。
- 配置导入导出升级为向后兼容的 version 3：普通 YAML 预览始终遮罩 VNC 密码；加密导出才可包含完整 VNC profile；导入过程不回显密码，也不接受遮罩值作为密码。

### 3.2 远端安全协商与身份

| 连接方式 | MVP 许可 | 安全要求 |
| --- | --- | --- |
| SSH tunnel + None | 是 | 复用 SSH host-key TOFU；远端 RFB 本身无认证时仍须用户确认目标风险 |
| SSH tunnel + VNC password | 是 | 密码只在 Rust 使用；SSH 提供传输加密 |
| direct TCP + None / VNC password | 受限 | 每次连接显式风险确认；不得默认自动重连或剪贴板同步 |
| direct TCP + VeNCrypt TLS / X.509 | Phase 3 | 证书链 / 主机名 / pin 校验失败即拒绝；自签名需要显式信任 |
| RealVNC RSA-AES、Apple DH、UltraVNC MSLogonII | 后续评估 | 先验证协议、库审计、许可证与跨平台互操作，不静默降级 |

- RFB 安全协商只允许配置明确允许的 security type；服务器只提供弱于策略的方式时，以安全策略错误失败，不做静默 fallback。
- TLS 阶段使用系统根证书或用户指定 CA；首次自签名证书显示 SHA-256 指纹并要求确认 pin，变更时拒绝。不得把 SSH known_hosts 机制错误复用于 X.509。
- 密码、挑战响应、证书、WebSocket capability、RFB 原始帧及剪贴板正文均不得进入 AppError、遥测、panic、测试 fixture 或 debug log。敏感缓冲区用 zeroize 或同等机制尽快清理。

### 3.3 会话、状态与错误

VNC runtime session 是进程内对象，独立于 profile：

~~~text
Idle → Connecting → AwaitingRenderer → Connected → Disconnecting → Closed
                         │                 │
                         └──── Failed ◄────┘
~~~

- 创建 VNC 标签前先调用 start_vnc_session。后端解析 profile、读取 secret、建立 direct TCP 或 SSH channel、完成远端认证，并仅在成功后返回短时 renderer endpoint。
- 关闭标签、断开、编辑 profile、SSH tunnel 失效、独立窗口主动关闭或 bridge 连接断开时，VncManager 关闭远端 stream、撤销 capability、释放 SSH ChannelLease；不得关闭同一 SSH transport 上的 SFTP / 终端。
- 首版提供“重新连接”按钮，默认不自动重连。Phase 4 可为 SSH tunnel 加入用户可配置的退避重连；必须限制尝试次数，避免触发服务器认证锁定。
- 状态事件只含 vncSessionId、profileId、状态、非敏感错误码和用户可读摘要；host、密码、token 和原始服务器失败消息不可透传到浏览器日志。
- 初始错误码至少包括：vnc_profile_not_found、vnc_tunnel_profile_missing、vnc_endpoint_unreachable、vnc_protocol_unsupported、vnc_security_unsupported、vnc_auth_failed、vnc_certificate_invalid、vnc_renderer_unavailable、vnc_session_closed。

## 4. 后端模块与 Tauri 契约

建议目录如下，DTO 位于 models/：

~~~text
src-tauri/src/
├── vnc/
│   ├── mod.rs
│   ├── manager.rs
│   ├── profile.rs
│   ├── rfb_handshake.rs
│   ├── bridge.rs
│   ├── transport.rs
│   ├── direct_tcp.rs
│   ├── ssh_tunnel.rs
│   └── tls.rs                 # Phase 3
├── models/vnc.rs
└── commands/vnc.rs
~~~

- VncManager 由 AppState 持有，管理 profile 无关的 session registry、bridge listener 与清理任务。
- 在 ChannelOwner 增加 Vnc，由 SshConnectionPool 取得 lease 并打开 direct-tcpip；不得从 VNC 模块重新实现 SSH 认证、代理或 host-key 校验。
- 直接 TCP 也只在 Rust 建立。连接超时、DNS、RFB handshake 和读写空闲时间分别设置上限；取消必须中断未完成 socket。
- VNC profile CRUD 与 session 命令分离：

~~~text
list_vnc_profiles / create_vnc_profile / update_vnc_profile /
delete_vnc_profile / set_vnc_profile_favorite / test_vnc_profile

start_vnc_session / close_vnc_session / reconnect_vnc_session /
set_vnc_session_view_only / list_vnc_sessions
~~~

- start_vnc_session 返回不可持久化的 session descriptor（sessionId、wsUrl、桌面名称 / 尺寸的非敏感摘要）；前端不自行拼装 URL、端口或 token。
- 全部载荷使用 camelCase；前端经 invokeCommand 统一将 AppError 转为用户提示。Tauri capability 改动与新增 detached-vnc-* 窗口标签需要完全重启应用验证。

## 5. 界面与交互

### 5.1 连接管理

- 连接类型增加 VNC 与显示器图标；新建菜单、类型筛选、搜索、最近使用、收藏、网格 / 列表 / 标签树都显示 VNC。
- VNC 编辑器顺序：名称 / 标签 / 描述 → 传输方式 → endpoint → 认证方式 → 默认共享与只读 → 安全警告 / 测试连接。
- SSH tunnel 模式先选择已保存 SSH profile；下拉只显示可用 SSH profile，并显示“通过 <profile> 到 <target>”。目标 hostname 按网关语义解释。
- 测试连接进行真实但短暂的 TCP / SSH + RFB 协商；成功显示服务器桌面名、协议版本、安全方式和 framebuffer 宽高，不打开交互式标签，也不记录密码。

### 5.2 VNC 工作区

~~~text
┌─────────────────────────────────────────────────────────────────┐
│ server-desktop · VNC     [只读] [缩放] [裁剪] [剪贴板] [断开]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    noVNC remote framebuffer                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 已连接 · SSH 隧道 · 1920 × 1080                  [全屏] [重连] │
└─────────────────────────────────────────────────────────────────┘
~~~

- 每个 VNC workspace 对应一个 VncSession；标签图标为 monitor，标题使用 profile name，状态通过 aria-label / tooltip 表示。
- 默认按容器缩放；用户可切换 100%、适合窗口、裁剪视口和服务器支持时的远端尺寸请求。缩放不改变服务端分辨率。
- 提供全屏、重新捕获键盘、发送 Ctrl-Alt-Del、刷新画面、断开与重新连接。系统保留快捷键不得无提示地吞掉。
- 默认交互式；只读可在会话中随时切换，并在画布上可见标识。只读时必须阻断所有键盘与指针上行，而不只是隐藏控制按钮。
- 剪贴板分为“远端读取到本机”和“从本机粘贴到远端”，默认均关闭。读取方向遵守系统 clipboard 权限与用户手势；内容只留在内存，不进入历史、AI 上下文或日志。
- VNC 标签不能显示终端 split 操作，也不参与 PaneGrid。命令面板只展示适用的 VNC 动作。
- Phase 2 支持移至独立窗口。重新挂载 noVNC renderer 时 bridge / remote VNC session 保持；关闭独立原生窗口按现有语义还原主窗口，明确关闭标签才结束 VNC session。

### 5.3 活动会话与 AI

- 会话侧栏在 SSH 节点之外增加“VNC 桌面”分组，列出连接状态与“显示、只读、重连、断开”动作；不伪装为 SSH host 节点。
- AI 首版可执行无副作用的“显示 VNC 标签”与“切换只读”应用操作，不读取屏幕像素、剪贴板、密码或远端桌面标题以外的内容；不能向 VNC 发送输入、创建连接或绕过直接连接风险确认。

## 6. 质量、互操作性与发布门槛

### 6.1 协议和安全测试

- 使用可重复的 TigerVNC / QEMU / x11vnc 容器或 VM fixture 覆盖 RFB 3.3 / 3.8、None、VNC password、失败认证、不同 desktop name、桌面 resize、常见 Tight / ZRLE / Hextile 编码及 server disconnect。
- handshake 有字节级 unit / golden tests，尤其覆盖长度上限、异常版本、security type 为空、错误 reason、部分读写、取消与超时；fuzz 入口不得让畸形 RFB 造成 panic 或无限内存分配。
- bridge 集成测试验证 token 单次使用、过期、错误 Origin、非回环 bind、第二 renderer、关闭后拒绝和不输出 token / password。
- SSH tunnel 测试验证同一 transport 下并发终端、SFTP、VNC，且关闭 VNC 只释放 Vnc channel；host-key 首次信任、变更拒绝、网关失联和 target 不可达分别可定位。
- 保存密码、编辑保持、清除、删除、加密导入导出与系统密钥链失败均做回归测试，证明秘密不进入 list / profile DTO。

### 6.2 前端、平台与性能测试

- VNC workspace 必须在 macOS / Windows 的 Tauri WebView 真实运行，覆盖焦点、输入法、键盘修饰键、Ctrl-Alt-Del、触控板滚动、DPI、窗口缩放、全屏、深浅主题、隐藏 / 恢复和独立窗口。
- noVNC 被卸载时应 disconnect、移除监听器和释放 canvas；反复打开 / 关闭不得留下 WebSocket、动画帧、DOM 或 Rust session。
- 在 1080p 交互、静态桌面、网络高延迟和频繁 resize 下测量帧率、CPU、内存与重连时间；Phase 0 设定基线并在发布前记录回归阈值。
- 所有前端改动通过 pnpm exec tsc --noEmit 与 pnpm build；所有 Rust 改动通过 cargo fmt、cargo clippy --all-targets -- -D warnings 与 cargo test。

## 7. 分阶段范围

| Phase | 交付 | 发布意义 |
| --- | --- | --- |
| 0 | RFB / noVNC / 回环 bridge / SSH channel / SecretStore spike | 决定可安全实现的最小协议面 |
| 1 | VNC profile、SSH tunnel MVP、None / VNC password、标签工作区 | 首个可用且凭据不出 Rust 的 VNC viewer |
| 2 | 日常交互、剪贴板、只读、独立窗口、命令面板 / 会话树 | 与现有工作区体验对齐 |
| 3 | VeNCrypt TLS / X.509、证书策略与受限 direct TCP | 把直连 VNC 提升到可发布安全基线 |
| 4 | 恢复、可观测性、跨平台与真实服务器矩阵 | 可靠性发布门槛 |
| 5 | Repeater、额外 security type 与其他增强 | 可选，不阻塞首版 |

Phase 0 未证明“不把密码交给 WebView”的可行 bridge，或系统密钥链不能可靠保存 VNC 密码时，不得开始 Phase 1 的密码保存与正式发布；可继续探索每次输入、仅 SSH 隧道的受限开发体验。

## 8. 研究依据

- [noVNC README](https://github.com/novnc/noVNC) 说明 noVNC 需要 WebSocket 或 WebSocket-to-TCP bridge，并列出认证、编码、缩放、裁剪、远端 resize 和 Unicode clipboard 的能力。
- [noVNC API](https://novnc.com/noVNC/docs/API.html) 定义 RFB 对象、credentials、连接、断开、clipboard、security failure 与 server verification 事件。
- [TigerVNC vncviewer 手册](https://tigervnc.org/doc/vncviewer.html) 提供自动编码选择、共享 / 只读、剪贴板、远端 resize、SSH gateway 和 TLS / X509 security type 的主流客户端参考。
- [RFC 6143](https://datatracker.ietf.org/doc/html/rfc6143) 定义 RFB 3.8 及 3.3 / 3.7 回退、security handshake 与安全通道原则；[RFC 7869](https://www.rfc-editor.org/info/rfc7869/) 记录 VNC URI 的连接 / 安全参数和 Integrated SSH channel 概念。
