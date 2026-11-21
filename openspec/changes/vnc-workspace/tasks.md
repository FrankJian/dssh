# Tasks

> 导入 2026-11-21 前已有任务；复选状态逐项保留。导入完成不代表功能实现或验收通过。
> 来源：根 `tasks.md`。旧控件类、Graphite 名称和“合并回主窗口”表述属于原方案，实现以当前设计规则与工作台所有权为准；先核对差异，不能直接沿用旧实现假设。

> Phase 0–4 尚未实现；Phase 5 可选，不阻塞首版。

## VNC 远程桌面工作区

> 状态：尚未开始。实施严格遵循 [VNC 远程桌面工作区规格](design.md) 的 Phase 0 → 1 → 2 → 3 → 4；Phase 5 为可选增强，不属于首版发布门槛。VNC 不能作为 SSH profile 的字段扩展，且不能把已保存 VNC 密码下发给 WebView。

## 1. Phase 0：协议、桥接与安全门禁

- [ ] 1.1 **V0.1 RFB / noVNC 兼容性 spike**：锁定候选 @novnc/novnc 版本与 MPL-2.0 合规方式，在 Tauri macOS / Windows WebView 创建最小 RFB renderer；核对 noVNC 的 WebSocket、resize、clipboard、view-only、键盘和卸载 API，记录最小浏览器 / WebView 版本与打包体积变化。
- [ ] 1.2 **V0.2 Rust RFB 握手 spike**：针对受控 TigerVNC / QEMU fixture 实现或审计 RFB 3.3 / 3.7 / 3.8 版本协商、None、经典 VNC Authentication、ClientInit / ServerInit、错误 reason、取消和读取长度限制；用字节级 golden test 覆盖部分读写与畸形报文。不得以长期无人维护 crate 作为未经审计的唯一安全边界。
- [ ] 1.3 **V0.3 本地 RFB bridge spike**：验证 Rust 在远端认证完成后，可向 noVNC 暴露仅本次会话的本地 None RFB 握手并透明 relay 已建立流量；证明 noVNC 不需要取得远端密码，desktop 初始化、SetPixelFormat、SetEncodings、输入和 framebuffer update 均能正常工作。
- [ ] 1.4 **V0.4 回环 capability 安全 spike**：实现临时 127.0.0.1 / ::1 listener、密码学随机且一次性的 capability、受控 Origin、连接 / 握手超时、单 renderer 限制和关闭清理；覆盖 token 重放、错误 Origin、第二客户端、超时与日志脱敏。不得暴露通用 LAN WebSocket-to-TCP proxy。
- [ ] 1.5 **V0.5 SSH tunnel spike**：为 SSH connection pool 增加 Vnc channel owner，验证从已认证 transport 打开 direct-tcpip 到网关视角的 VNC target；覆盖并发终端 + SFTP + VNC、target 不可达、host-key 提示 / 变更、channel 限额与关闭 VNC 后仅释放其 lease。
- [ ] 1.6 **V0.6 凭据与许可证门禁**：先完成或最小接入系统 SecretStore，使 VNC password 不会落入普通 SQLite；定义清除、引用计数、导入导出和 zeroize 规则。完成 noVNC 及新增 Rust 依赖的许可证、供应链、跨平台构建和 NOTICE 审查。

**Phase 0 验收**：在 macOS 和 Windows 各连接一个受控 VNC server，画面和输入正常，保存密码没有进入前端 / SQLite / 日志；经 SSH 隧道能与现有 terminal / SFTP 并存；关闭 renderer / 标签会收回 listener、capability 与 channel。任一项不成立时，不进入正式 profile 或凭据保存开发。

## 2. Phase 1：安全的连接模型与 VNC MVP

- [ ] 2.1 **V1.1 独立 VNC profile 与迁移**：新增 vnc_profiles migration、Rust / TypeScript DTO、独立 repository 和 CRUD；字段覆盖名称、SSH tunnel 或 direct TCP、target host / port、None 或 VNC password、shared、默认只读、收藏、标签和描述。保留现有数据库和 SSH profile 兼容性。
- [ ] 2.2 **V1.2 SecretStore、删除与配置文件**：实现 VNC password 的创建、更新保持、显式清除和删除清理；普通 YAML 预览遮罩、加密导出 / 导入含 VNC profile，并升级 document version 而不破坏旧格式。安全存储不可用时拒绝保存密码，不回退到明文表。
- [ ] 2.3 **V1.3 VncManager 与传输**：新增进程内 session registry、direct TCP 与 SSH direct-tcpip transport、RFB handshake、短时 bridge、状态事件、连接 / 读写超时、取消与确定性资源释放。direct TCP 仅作为显式确认后的受限模式：禁用自动重连和默认剪贴板同步。
- [ ] 2.4 **V1.4 命令与服务层**：注册 list / create / update / delete / favorite / test VNC profile，以及 start / close / reconnect / list VNC session 命令；所有载荷 camelCase，经 invokeCommand 规范化 AppError。start 只返回不可持久化 renderer descriptor，前端不拼接 token 或读取 secret。
- [ ] 2.5 **V1.5 连接管理接入**：在 connectionTypes、SessionManager、新建菜单、类型筛选、搜索、最近、收藏和卡片中接入 VNC；增加 VncProfileEditor，清晰区分直连与“通过 SSH profile”目标，测试连接仅显示非敏感 RFB 摘要。
- [ ] 2.6 **V1.6 VNC 标签工作区**：新增 useVncSessions、VncWorkspace、VNC 服务层和 monitor tab kind；以 noVNC 挂载 renderer，支持连接、断开、手动重连、状态 / 错误空态和适配窗口缩放。VNC 不进入 PaneGrid，终端 split 操作在 VNC 标签激活时不可用。

**Phase 1 验收**：可保存并编辑 SSH tunnel VNC profile；以 None 和 VNC password 各连接一个受控服务器，打开两个 VNC 标签，与 SSH terminal / SFTP 同时运行；关闭任何 VNC 标签不影响 SSH transport 上其他 channel；直接 TCP 的风险确认、错误提示和无密码泄露均可验证。

## 3. Phase 2：日常交互与工作区一致性

- [ ] 3.1 **V2.1 视图与输入控制**：实现适合窗口 / 100% 缩放、裁剪、全屏、重新捕获键盘、刷新画面、Ctrl-Alt-Del、shared 与会话内 view-only；view-only 必须在客户端阻断键盘 / 指针上行并有明显状态标识。
- [ ] 3.2 **V2.2 剪贴板安全交互**：分别实现“远端 → 本机”和“本机 → 远端”的显式开关、权限与用户手势处理；默认关闭，正文只在内存短暂存在，不写 localStorage、历史、日志或 AI 上下文。
- [ ] 3.3 **V2.3 会话树与命令面板**：在活动会话侧栏增加独立 VNC 桌面分组，提供显示、只读、重连、断开动作；在 ⌘K 增加适用 VNC 动作，并保证 AI 只能调用显示 / 只读等无副作用界面控制。
- [ ] 3.4 **V2.4 独立窗口**：扩展 DetachedWorkspace 模型、manager、capability 与前端以支持 detached-vnc-*；窗口移动、回归主窗口、关闭标签、renderer 重新挂载和焦点切换均保留或正确关闭 VncSession，且完整重启 Tauri 验证 capability。
- [ ] 3.5 **V2.5 交互回归**：真实验证 macOS / Windows 的键盘修饰键、输入法、触控板、DPI、窗口缩放、全屏、深浅主题、隐藏恢复、快速开关标签和 renderer 卸载，修复 WebSocket / canvas / listener 泄漏。

**Phase 2 验收**：VNC 在主窗口和独立窗口间切换后仍可安全交互；只读与两个方向的剪贴板权限均遵守设置；VNC 相关控制不会影响终端 / SFTP 的标签、分屏或快捷键。

## 4. Phase 3：加密直连与服务器身份验证

- [ ] 4.1 **V3.1 VeNCrypt TLS 测试矩阵**：在受控 TigerVNC / QEMU 环境验证 TLSNone、TLSVnc、TLSPlain、X509Vnc 等实际提供的安全类型，确定首批支持集、TLS 版本、cipher、协议 fallback 和不支持错误；没有完整证据的厂商类型不得暴露为可用选项。
- [ ] 4.2 **V3.2 TLS 实现与证书策略**：在 Rust 侧实现 TLS / VeNCrypt 协商，使用系统根证书或用户选择的 CA，验证 hostname、链和有效期；自签名证书首次显示 SHA-256 指纹并建立 pin，变更时硬失败。SSH known_hosts 与 X.509 信任记录必须隔离。
- [ ] 4.3 **V3.3 Direct TCP 发布门禁**：将 direct TCP 的可用性与安全方式绑定：无 TLS 或仅 VNC password 时每次显式确认并显示受限状态；TLS 验证通过后才启用完整直连体验。不得因服务器协商失败而退回明文 / 弱认证。
- [ ] 4.4 **V3.4 认证与证书数据生命周期**：补齐 username / password 在安全类型适用时的临时输入和 SecretStore 引用，零化挑战、密码、私钥和会话能力；补齐更新、导出、导入、删除、证书替换及错误日志的回归测试。

**Phase 3 验收**：对受信任 CA、自签名首次 pin、证书变更、hostname 不匹配、过期证书、仅弱安全类型和认证失败分别得到正确结果；任何失败均不能降级到未验证直连或泄露秘密。

## 5. Phase 4：恢复、性能与发布验证

- [ ] 5.1 **V4.1 断线与重连策略**：为 SSH tunnel 与直连分别实现受用户控制的指数退避重连、取消、认证失败停止、最大次数和明确 UI 状态；不得因为网络抖动高频重放密码造成服务器锁定。
- [ ] 5.2 **V4.2 资源与可观测性**：实现非敏感会话计数、bridge / SSH channel 关闭指标、内存与 listener 诊断，覆盖后台 / 恢复、目标重启、网关断线、DNS / timeout、服务器 resize、反复 renderer 重建与进程退出。
- [ ] 5.3 **V4.3 互操作与性能矩阵**：在 TigerVNC、QEMU / libvirt 与 x11vnc 等至少三类受控服务器上验证 RFB 3.3 / 3.8、常见 encoding、1080p、网络高延迟、窗口 resize 与键盘输入；记录帧率、CPU、内存和连接耗时基线。
- [ ] 5.4 **V4.4 端到端安全审计**：审计 Tauri command / event、SQLite、SecretStore、crash error、Toast、前端 console、AI tool、配置导入导出和依赖 NOTICE；确认密码、RFB 帧、clipboard 正文、certificate 私钥、bridge URL 与 token 不可见。
- [ ] 5.5 **V4.5 CI 与发布验证**：增加 Rust unit / integration 测试和前端组件测试；在 macOS / Windows 完成 pnpm exec tsc --noEmit、pnpm build、cargo fmt、cargo clippy --all-targets -- -D warnings 与 cargo test，并在当次发行构建重新执行真实 VNC 矩阵。

**Phase 4 验收**：所有支持路径的连接、关闭、网络故障、认证失败与恢复不会泄漏资源或敏感数据；跨平台真实服务器矩阵通过后，VNC 才能从试验功能进入发布功能。

## 6. Phase 5：可选增强，不进入首版发布门槛

- [ ] 6.1 **V5.1 VNC Repeater**：评估并实现独立的 repeater ID / host 路由模型；它不能复用或暴露本地 bridge token。
- [ ] 6.2 **V5.2 额外认证类型**：在安全与互操作验证后按需支持 RealVNC RSA-AES、Apple Diffie-Hellman、Tight / UltraVNC 特定认证；每种类型独立记录许可证、secret 形态、协商与降级策略。
- [ ] 6.3 **V5.3 Server capability 优化**：ContinuousUpdates、Fence、ExtendedDesktopSize、质量 / encoding 提示等仅在后端和 noVNC 两侧均已验证时启用，并能回退到标准帧更新。
- [ ] 6.4 **V5.4 受控导入**：单独设计 .vnc、.tigervnc 或厂商 profile 的导入映射、危险字段过滤、密码处理和预览脱敏；不执行导入文件内的命令或外部引用。
- [ ] 6.5 **V5.5 录制与审计探索**：如有合规需求，先定义用户可见状态、加密存储、保留期、磁盘配额和敏感屏幕数据告知，再评估录制，不复用 websockify 的流量记录功能。
