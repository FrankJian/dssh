# Windows 远程桌面（RDP）方案

> 状态：已实现独立窗口直连 MVP；其余阶段仍为设计范围。调研日期：2026-11-01。当前代码与验收边界见 [实施说明](rdp-implementation.md)。
> 用户已确认：首版允许独立桌面窗口，由 Duo SSH 统一管理连接；稳定性优先。
> 本文不改变已有 VNC 提案或其任务状态，不代表相关能力已经通过实机验证。

## 1. 结论

首选 **RDP + FreeRDP 协议内核 + 每会话独立的原生客户端子进程**。React 负责连接管理与状态，Rust 负责配置、凭据、SSH 路由、进程监督和权限；桌面像素与输入在客户端子进程内处理。

先做 Windows / macOS 均可运行的独立桌面窗口，不把跨进程原生窗口强行嵌入 Tauri WebView。FreeRDP 的 SDL 客户端可作为原生显示、键盘、鼠标和剪贴板适配的起点；最终采用哪个 release、哪些 SDL 实现必须经双平台 spike 确认。**协议库成熟不等于本项目的客户端集成已经稳定。**

RDP 适合 Windows Pro / Enterprise 和 Windows Server 的远程登录。目标机必须启用远程桌面、允许对应账号登录且网络可达；Windows Home 不作为内置 RDP 服务端支持目标。RDP 也不等于远程协助或保证共享当前物理屏幕：桌面锁屏、会话复用、多人登录与许可受目标系统及策略约束。需要 Home、当前屏幕协助或 NAT 穿透时，再独立评估 VNC / RustDesk 类方案。

## 2. 开源实现比较

以下选型是结合本项目约束的工程判断，不是通过同一测试集得出的性能或可靠性排名。

| 实现 | 可借鉴内容 | 对 Duo SSH 的判断 |
| --- | --- | --- |
| [FreeRDP](https://github.com/FreeRDP/FreeRDP) | RDP 协议、认证与证书回调、虚拟通道、原生客户端；Apache-2.0 | 首选内核；新增 C/C++、SDL、TLS 等构建与分发工作，放入子进程隔离 |
| [IronRDP](https://github.com/Devolutions/IronRDP) | Rust 协议实现、原生 viewer、Web 客户端；MIT / Apache-2.0 双许可 | 有生产使用案例，值得保留为候选；若未来必须内嵌，再验证 Rust 后端认证与 Web 渲染组合，不能直接照搬演示客户端 |
| [Apache Guacamole](https://github.com/apache/guacamole-server) | RDP 经 guacd 转为浏览器显示协议；Apache-2.0 | 适合已有集中网关的部署；不作为本地桌面软件首版依赖，避免引入常驻网关和额外协议层 |
| [Remmina](https://github.com/FreeRDP/Remmina) | FreeRDP 集成、会话管理与重连体验 | 参考产品行为和故障处理，不直接移植 GTK 客户端 |
| [mRemoteNG](https://github.com/mRemoteNG/mRemoteNG) | 多协议管理器、Windows RDP 控件集成 | 参考管理交互；Windows 控件路线无法统一 macOS，实现代码也须遵循其许可证 |
| [RustDesk](https://github.com/rustdesk/rustdesk) | 被控端、远程协助、中继与连接管理 | 属于另一类产品架构；若需求变为跨公网控制当前屏幕再评估，不作为 RDP 库使用 |

可提供“使用系统客户端打开”作为后续手动兼容入口，Windows 使用 mstsc、macOS 使用已安装的 Microsoft 客户端；它不作为主引擎，也不冒充可准确监督的受管会话。不自动安装第三方客户端，不通过命令行或临时文件传密码。

## 3. 与现有架构的接入点

已核对 `app/AppState`、SSH connection pool、连接类型目录、统一标签条与 detached workspace 模型。当前连接管理目录仍是 SSH 的适配层，不能只增加一个 RDP 枚举值就认为已支持多协议。

| 当前模块 | 建议变更 |
| --- | --- |
| `src/ssh/connectionTypes.ts` / `SessionManager.tsx` | 增加 RDP 类型、独立编辑器与 `ConnectionProfile` 判别联合；列表聚合 SSH / RDP，但不改写 SshProfile |
| `src/models/` / `src/services/` | 独立 RDP DTO、invoke 封装和错误规范化 |
| `src/rdp/` | `RdpProfileEditor`、`useRdpSessions`、会话列表 / 状态与启动入口 |
| `src-tauri/src/app/mod.rs` | AppState 新增 RdpManager，注入 repository、SecretStore、ssh_pool |
| `src-tauri/src/rdp/` | manager、worker_supervisor、ipc、transport、certificate_store、reconnect |
| `src-tauri/src/models/rdp.rs` / `commands/rdp.rs` | camelCase DTO、CRUD / 会话命令；在 lib.rs 注册 |
| `src-tauri/src/storage/` / `migrations/` | 独立 RDP 表、迁移与 repository 方法；编号按实施时最新序列分配 |
| 新增原生 worker 工程 | 链接固定 FreeRDP / SDL 版本，生成随应用签名分发的 dssh-rdp-client |

首版连接管理器和会话侧栏增加 RDP 入口；点击活动桌面聚焦原生窗口。无需修改 PaneGrid，也不为独立窗口伪造一个显示桌面像素的标签。若需要标签，只呈现明确的会话控制页。

## 4. 运行架构与进程边界

```text
React：连接编辑器 / 活动会话 / 命令面板
                 │ Tauri invoke / 定向状态事件
                 ▼
Rust RdpManager ── SQLite：配置与证书信任记录
       │         └ SecretStore：OS Keychain / Credential Manager
       │ 每会话私有 IPC：启动、凭据、信任确认、状态、关闭
       ▼
dssh-rdp-client（一个会话一个进程，FreeRDP + 原生显示）
       ├── 直接 TCP/TLS/NLA ──────────────────► Windows RDP
       └── 私有本机转发 ─► Rust ─► SSH pool direct-tcpip ─► Windows RDP
```

- 受管 worker 是一个小型自有适配程序，可复用 FreeRDP SDL 客户端代码；需要实现结构化 IPC 和认证 / 证书回调，不是简单拼接现成 CLI 参数。
- 每个会话独立进程，避免某个原生解码器崩溃带倒 Tauri 主进程；这只是故障隔离，不代表已实现安全沙箱。
- worker 启动参数只含非秘密标识；不把密码放在 argv、环境变量、普通 .rdp 文件、stdout 或 stderr。
- macOS 优先使用继承的匿名管道 / socketpair；Windows 使用限制访问的匿名管道或 Named Pipe。确认句柄继承范围、协议版本、消息长度上限、超时和父进程身份。不要开放一个无认证的本机管理 HTTP 服务。
- 大量画面、鼠标和键盘事件不经过 Tauri JSON emit；控制面只发状态、信任提示、尺寸摘要等低频消息。
- 初期仅承诺一个桌面窗口对应一个会话。同一 profile 再次打开默认聚焦已有窗口；用户显式选择才新建客户端连接，且不保证服务端产生新的登录会话。

## 5. Profile、凭据与信任

建议公开 DTO 只包含非秘密字段：

```ts
type RdpRoute =
  | { kind: "direct" }
  | { kind: "sshTunnel"; sshProfileId: string };

interface RdpProfile {
  id: string;
  name: string;
  host: string;                 // 真正的 Windows endpoint
  port: number;                 // 默认 3389
  serverName?: string;          // 显式配置的 TLS / 认证服务身份
  username: string;
  domain?: string;
  hasPassword: boolean;
  route: RdpRoute;
  display: { width: number; height: number; fitWindow: boolean };
  clipboard: "off" | "textBidirectional";
  favorite: boolean;
  tags: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}
```

认证类型、RD Gateway、音频和多显示器配置在实际实现对应能力时再加入，避免首版保存尚不支持的选项。profile 编辑使用显式的密码 keep / replace / clear 操作，避免空值语义不明。编辑只影响后续连接，已有会话使用配置快照。

- 配置存在 SQLite；新增密码通过 SecretStore 存入 macOS Keychain / Windows Credential Manager，SQLite 仅存引用。当前 TODO 中全量旧凭据迁移可以分期进行，但新增 RDP 保存密码不能继续写入明文表。
- SecretStore 不可用时允许“本次输入、不保存”。保存的密码不通过查询 DTO 回到前端；一次性输入可使用可信应用表单写入 Rust，或 worker 原生提示，处理后尽快清除。FreeRDP 内部复制的敏感缓冲区也要检查生命周期，不能只依赖 Rust zeroize 宣称全部已清除。
- 首版以 NLA / CredSSP 为认证基线；账号、域、本地账户命名分别验证。协商失败不自动退回旧 RDP Security 或关闭 NLA。
- 系统 CA 校验有效证书及主机名。自签名证书需明确显示真实目标、SHA-256 指纹、有效期和路由，让用户选择单次信任或保存 pin；已保存 pin 变化拒绝自动连接并要求重新核对，不能设置全局“忽略证书”。
- 用户明确要求兼容内网证书警告后，新增**每个 RDP profile 单独开启**的“跳过服务器证书验证（不安全）”，缺省关闭。开启后跳过证书链 / 名称 / pin 验证，同时保留 TLS 和 NLA，并在编辑器、连接卡片、会话及原生标题显示风险；不自动修改其他连接或 SSH 的信任策略。关闭后恢复原有证书配置。
- SSH host key 和 RDP X.509 信任独立，SSH 已信任不代表 RDP endpoint 已信任。证书提示需在发送 Windows 密码前完成，具体调用时序必须在 spike 中验证。
- 复用现有加密导入导出框架时增加兼容版本，普通导出不包含 RDP 密码；旧 SSH 文件仍可导入。首版也可明确暂不支持 RDP 导入导出，不能因通用导出而漏出秘密。

## 6. SSH 路由与内网 Windows

RDP 目标机不必运行 SSH。已有 Linux / Windows SSH 网关通过 direct-tcpip 访问内网 Windows 的 3389 即可：

```text
Duo SSH → 已保存的 SSH 网关 → Windows:3389
```

- 在 ChannelOwner 增加 Rdp，复用 SshConnectionPool 的认证、TOFU、代理与租约 / 通道额度。关闭 RDP 只关闭自己的 channel，不影响同 transport 的终端、SFTP 或其他桌面。
- target host 按网关视角解析。保存 SSH profile ID，不复制网关密码。删除网关 profile 不级联删除 RDP 配置，标记路由失效并允许修复。
- 为兼容 FreeRDP TCP 路径，可由 Rust 为每会话建立临时、仅回环的 TCP listener，连接到固定目标；只在 worker 建立连接期间开放，连接后关闭监听，取消和失败立即释放。重连时重新创建，禁止成为通用端口转发服务。
- 回环地址本身不认证本机进程；需要评估连接抢占风险。优先验证继承已连接 socket / 自定义 transport 的可行性。若仍采用回环 listener，不能声称它具备私有管道同等的访问隔离，并须验证抢占时失败关闭、无凭据泄漏及无错误目标信任。
- **TCP 连接地址和服务器身份必须分开。** 即使 worker 连接 127.0.0.1，也要用真实目标 / 显式 serverName 验证证书和 NLA 服务身份，不能把本地随机端口当作证书信任键。FreeRDP 有 server-name 设置与证书回调，但具体版本的 TLS、CredSSP / SPN 行为需要实机证明。
- SSH 通道只提供 TCP；首版不承诺 UDP 图形传输。SSH transport 恢复后必须重建 RDP 通道并重新协商，不能把新字节流接回旧 TLS 会话。
- RD Gateway 是独立协议和认证路径，不等同于 SSH gateway 或 SOCKS 字段；首版推迟，用户环境强依赖时再升级优先级。

## 7. 生命周期与可靠性

```text
Starting → AwaitingCredential / AwaitingTrust → Connecting → Connected
   └─────────────────────────────► Failed              │
                                         Reconnecting ◄┘
任意活动状态 → Disconnecting → Closed
```

- RdpManager 是会话状态的唯一权威。sessionId 与 profileId 分离；命令在 Rust 中从调用 WebView 识别 owner，不信任前端传入的 owner 字符串。借鉴现有 browser::trusted / owned，拒绝远程浏览器内容调用管理命令。
- 状态事件按 owner 定向投递，含 sessionId、revision、状态和脱敏错误。前端以快照 + revision 恢复，避免启动 / 关闭竞态或迟到事件复活已关窗口。
- IPC 断开、worker 退出、用户关原生窗口都要有明确处理。关闭操作幂等：先请求正常断开，超时才终止本会话进程，再清理管道、listener、SSH lease 和状态。
- 原生窗口关闭表示“断开客户端”，不执行 Windows 注销。远程程序是否继续运行由服务端策略决定；用户提示不能承诺任务永不停止。
- 关闭拥有该会话的工作台按当前窗口归属规则清理所属 RDP，会话不自动转移到主窗口；退出应用清理全部 worker。父进程异常退出用管道 EOF / 心跳退出，Windows 评估 Job Object kill-on-close，macOS 验证孤儿进程清理。
- 重连仅针对暂时性网络错误，建议初始 30 秒有界退避窗口，并可立即取消。由一个协调器管理，不能同时启用应用和 FreeRDP 两套无限重试。
- 登录失败、账号锁定 / 密码过期、证书变化、用户断开或远端注销停止自动重试。worker 崩溃进入 Failed，首版手动重开，防止 crash loop。
- 若服务器支持自动重连信息，只在 worker 内存保留；重连是否回到原 Windows 会话受服务端影响，不保证恢复原会话或应用状态。
- 错误需区分 DNS / 不可达、SSH 信任 / 路由失败、TLS 证书、NLA、账号策略、图形初始化、worker 崩溃和用户取消；不透传原始敏感诊断。采集连接阶段耗时、错误类别、退出码和引擎版本即可。

## 8. UI 与首版范围

连接管理器中新增独立 RDP 类型，支持名称、地址、端口、账号 / 域、凭据保存、SSH 网关、分辨率和收藏 / 标签。活动会话侧栏增加“远程桌面”分组，提供打开窗口、重连、断开。

原生窗口提供基本鼠标 / 键盘、滚动、全屏、适合窗口、100% 显示、释放键盘以及发送 Ctrl+Alt+Del。优先固定远端分辨率加本地缩放，动态分辨率只有在 resize 回归通过后启用。中文输入需分别验证本地 IME 文本输入和远端 IME 的扫描码路径，不能只验证英文键盘。

剪贴板默认关闭，仅显式开启纯文本双向同步；限制大小和转换，不写日志、历史或 AI 上下文。首版禁用磁盘、文件剪贴板、打印机、USB、麦克风、摄像头和智能卡重定向；音频播放后续按需加入。首版也不包含多显示器、RemoteApp、录制、云中继、Azure / Entra 特殊登录、智能卡 / MFA、RDS broker 重定向，以及未经验证的网关认证。

应用 UI 遵循 Graphite Glass tokens 和紧凑原生交互；原生桌面不加模糊。RDP 不参与终端分屏，不开放 SSH AI exec；首版 AI 不读取屏幕、不发送桌面输入。现有应用锁也须覆盖 worker：锁定时隐藏桌面、释放输入并关闭剪贴板同步，解锁后恢复；跨平台做不到可靠遮蔽时，明确采用断开客户端的策略。

## 9. 命令与发布工程

建议命令：

```text
list_rdp_profiles / create_rdp_profile / update_rdp_profile / delete_rdp_profile
start_rdp_session / list_rdp_sessions / focus_rdp_session
close_rdp_session / reconnect_rdp_session / respond_rdp_certificate_prompt
```

start 立即返回 session descriptor，连接进度异步更新。信任回复绑定 session、目标、证书摘要、过期时间及单次 requestId，不能复用旧确认。不要提供名为“测试连接”却只测试 TCP 端口的误导性成功提示；真实登录测试可能创建 Windows 会话，应显式说明。

worker 与主程序版本配套分发，IPC 启动握手校验版本，不匹配则明确失败。引擎选择固定 release / commit 和依赖锁，不跟随 master；升级需复跑相同矩阵。macOS 验证 arm64 / x86_64 所支持构建、动态库路径、签名与 notarization；Windows 验证 x64 干净系统安装、运行库、DLL 搜索路径和签名，新增架构另行承诺。

不要要求用户安装 Homebrew、XQuartz、Docker 或自行配置 FreeRDP。记录 FreeRDP、SDL、TLS、图形 codec 等第三方依赖、许可证与 NOTICE；额外 codec 的分发条件单独检查，不把主库 Apache-2.0 当作整个二进制的统一许可结论。现有 CI 还需新增 native worker 的构建、依赖审计及安装包 smoke test。

## 10. 分期与发布门槛

| 阶段 | 交付 | 必须证明 |
| --- | --- | --- |
| P0：双平台技术验证 | 固定 FreeRDP 版本、原生窗口、私有 IPC、认证与证书回调、打包样例、SSH tunnel | macOS / Windows 都能连接真实 Windows；秘密不进 argv / 日志；隧道证书与 NLA 身份正确；关闭与崩溃可回收 |
| P1：受管 RDP MVP | 独立 profile、SecretStore、直连、独立窗口、会话列表、全屏 / 缩放、手动重连 | 连接 / 编辑 / 关闭 / 应用退出 / 应用锁可预测，不影响现有 SSH 功能 |
| P2：内网与恢复 | pool SSH 路由、有界自动重连、中文输入完善、可选文本剪贴板 | 网关抖动、睡眠唤醒、账号失败和低通道额度均不误重试、不泄漏资源 |
| P3：可靠性发行 | 真机矩阵、长稳、多会话、签名安装包与故障记录 | 支持范围全部通过，才从试验功能变成正式支持 |
| P4：按需扩展 | RD Gateway、音频、多显示器、动态分辨率、内嵌工作区 | 每项独立验证，不能因引擎提供能力就自动宣布已支持 |

P0 如果 FreeRDP SDL 在目标平台的输入 / 打包不达标，先比较同版本原生客户端或 IronRDP viewer；不要在没有实测证据时继续堆工作区 UI。P0 的样例不算可发布功能。

建议可靠性验收基线（是待验证目标，不是现有成绩）：

- Windows 11 Pro、Windows Server 2019 / 2022 / 2025；本地账户与 AD 域账户、NLA、有效 CA、自签名首次信任 / 已信任 / 证书变更。Home 明确提示不支持服务端；特殊身份系统列为未支持。
- macOS Apple Silicon 与支持的 Intel 构建、Windows 11 x64；Retina / 不同 DPI、跨屏、全屏、中文输入、修饰键、Ctrl+Alt+Del、切焦点释放按键、系统锁屏与应用锁。
- 直连及 SSH 网关；同 SSH transport 并行终端 + SFTP + RDP；受限通道额度、错误密码、DNS 失败、目标拒绝连接、断网 / 网关重启、50–150ms RTT 与适度丢包。
- 至少 8 小时交互 / 空闲混合长稳、4 个并发桌面、100 次连接 / 关闭循环和 20 次短时断网恢复；不得出现主进程崩溃、孤儿 worker、挂起关闭、卡住修饰键或持续资源增长。
- 1080p 日常办公操作下记录连接耗时 p50 / p95、输入延迟、CPU / 内存和稳定性；P0 建立可复现基线，再给发布回归设数值阈值，不预先承诺固定 FPS。
- 进程崩溃、父进程退出、IPC 关闭和取消发生在各连接阶段，均能回收 worker / socket / channel；认证与证书错误不被自动重连刷屏或触发账号锁定。
- 日志、事件、错误、导出、前端状态、进程参数中不包含保存的密码或重连凭据；证书变更必须拒绝，远程 browser WebView 无法调用管理命令。
- 实施后执行现有 pnpm TypeScript / build 和 Rust fmt / clippy / test，以及新增 worker 检查；自动检查不能替代 Windows / macOS 原生实机矩阵。

## 11. 后续内嵌路径

独立窗口满足首版需求，不承诺把 FreeRDP 窗口 reparent 到 Tauri：Windows HWND 与 macOS NSView 的跨进程嵌入、焦点、覆盖层、DPI 和生命周期不同，必须另立验证。

如果后续必须在统一标签显示桌面，优先比较两个 POC：

1. 保留 FreeRDP worker，新增有背压的二进制图形通道与 WebView renderer。脏矩形、纹理上传、帧丢弃 / 合并、输入、剪贴板都需完整设计，禁止使用 base64 + Tauri emit 持续传整屏。
2. 使用 IronRDP 的后端认证 / 解码与前端渲染组合，或借鉴其 Web 客户端组件。先确认凭据不由 WASM / JS 读取，以及 WKWebView / WebView2 的兼容性，不能假设替换 renderer 即可复用全部引擎能力。

若组织已有 Guacamole 服务，可另加受管网关连接类型；不要为了内嵌而在每个桌面安装完整 Java / guacd 服务栈。

复用统一标签、排序和 owner 模型，但增加明确的 RDP surface / session 类型。迁窗只改变显示与所有权，不重登远端；关窗结束所属客户端，不把会话恢复到其他窗口。已有 VNC 文档关于“关独立窗口回主窗口”的旧描述需在实际实施 VNC 时同步修正。

## 12. 一手资料与验证边界

- [FreeRDP 源码 / 构建入口](https://github.com/FreeRDP/FreeRDP)、[发行记录](https://github.com/FreeRDP/FreeRDP/releases)：版本与维护情况；本文未选定最终发布版本。
- [FreeRDP SDL3 客户端构建与源文件](https://github.com/FreeRDP/FreeRDP/blob/master/client/SDL/SDL3/CMakeLists.txt)：原生输入、窗口、显示与剪贴板实现参考，不代表目标 release 全部行为已验收。
- [FreeRDP 认证 / 证书接口](https://github.com/FreeRDP/FreeRDP/blob/master/include/freerdp/freerdp.h)、[server-name 参数处理](https://github.com/FreeRDP/FreeRDP/blob/master/client/common/cmdline.c)：自有 worker 安全回调和连接身份分离的实现入口，隧道行为仍须验证。
- [IronRDP](https://github.com/Devolutions/IronRDP)、[Web 客户端说明](https://github.com/Devolutions/IronRDP/blob/master/web-client/README.md)：有生产应用，示范 Web 客户端明确不能原样用于生产。
- [Guacamole 架构](https://guacamole.apache.org/doc/gug/guacamole-architecture.html)：浏览器、应用层、guacd 与远端协议之间的分工。
- [Microsoft 支持的 RDP 目标配置](https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remotepc/remote-desktop-supported-config)：目标 Windows 版本限制。

本文记录选型依据和完整目标；后续直连 MVP 的本地构建、边界测试与原生界面验证见实施说明。尚未连接真实 Windows 或完成长稳验收；各阶段支持范围和验收数值仍须以对应证据确认。
