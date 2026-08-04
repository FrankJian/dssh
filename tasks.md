# Duo SSH 实施任务

> 本文件记录已经完成规格评审、可以按阶段实施的任务。高层优先级与其他未排期事项见
> [`TODO.md`](TODO.md)，当前界面约定见 [`spec.md`](spec.md)，Kubernetes 完整规格见
> [`features/kubernetes-workspace.md`](features/kubernetes-workspace.md)。完成的任务应及时删除或压缩为简短记录，
> 避免与仍需实施的步骤混杂。

## Kubernetes 集群工作区

> 状态：Phase 0–5 的代码基础已完成，仍需真实集群、平台和权限矩阵验收。实施顺序遵循 Phase 0 → 1 → 2 → 3 → 4 → 5；Phase 6 明确保持为可选增强，不计入首版发布门槛。

### Phase 0：剩余技术预研与安全门禁

- [ ] **K0.1 依赖与版本矩阵**：验证当前稳定 Rust `kube` / `k8s-openapi` 与项目 Tokio、rustls、Tauri 依赖的
  兼容性，确定最低 / 最高 Kubernetes 服务端版本，记录 crate feature 和二进制体积变化。
- [ ] **K0.2 本地 kubeconfig spike**：覆盖默认配置、`KUBECONFIG` 多路径、手工路径、无扩展名文件、多个
  context、client certificate、bearer token 和 exec credential plugin；确认解析、刷新与错误分类。
- [ ] **K0.3 远端 kubectl spike**：在现有 SSH 连接池 channel 上验证版本探测、context 列表、API Discovery、
  `get -o json`、Watch、日志、stdin dry-run/apply、取消、超时与 transport 恢复。
- [ ] **K0.4 命令安全验收**：补充真实远端环境下的注入回归测试，覆盖路径、context、namespace 和资源名中的空格、
  Unicode、引号及恶意输入；禁止前端传完整命令字符串。
- [ ] **K0.7 后端抽象定稿**：用 spike 验证统一 `KubernetesBackend` 能覆盖本地 API 和远端 kubectl，定稿 DTO、
  operation id、取消、Watch / 轮询降级和错误码。

**已完成记录**：已引入并编译 `kube` / `k8s-openapi`；Rust 后端已提供本机 kubeconfig 扫描，以及经共享
SSH transport 的远端 kubectl / kubeconfig 自动发现命令。扫描结果仅包含 context、cluster、user、namespace 和
路径摘要；远端动态参数使用统一 POSIX 单引号转义，exec 输出增加上限。以下条目仅保留真实本地 / 远端集群、
exec plugin、版本矩阵与取消 / 重连场景的验收或尚未实现的安全设计。

本机 kubeconfig 的 exec credential plugin 现会显示非敏感摘要（来源、context、命令、参数摘要与环境变量名），
首次使用前必须由用户显式信任；信任按插件指纹持久化且可撤销。内嵌环境变量只允许少量非秘密位置 / 配置选择器，
认证加载错误不会回显插件输出。

应用管理的 kubeconfig 导入现使用 macOS Keychain / Windows Credential Manager（Linux 使用系统 Secret Service）；
SQLite 只保存随机引用、文件显示名和用于去重的 SHA-256 指纹。导入、重新扫描、编辑取消、来源替换和删除配置都会
通过后端管理该引用；同内容导入会复用已有安全存储项，原始 YAML 不经过前端。为避免“导入后仍从外部读取私钥”，含 `certificate-authority`、`client-certificate`、
`client-key` 或 `tokenFile` 引用的文件会被拒绝，并提示用户使用路径引用或嵌入凭据。已导入配置不会写入 CLI
终端环境；如需 CLI，用户必须明确改用路径引用来源。

**Phase 0 验收**：本地与远端各完成一个多 context 集群的只读查询；没有凭据进入前端或日志；明确列出暂不兼容
的认证插件、kubectl / 服务端版本和平台差异后，才能进入持久化开发。

### Phase 1：连接模型、来源与多 context

**已完成记录**：已完成 `kubernetes_profiles` 迁移、Rust / TypeScript DTO 与 CRUD、连接类型入口、local / remote
来源编辑器、系统文件选择、远端 kubectl 自动发现、context 扫描和多选，以及连接管理页的标签分组与类型筛选。

- [x] **K1.3 配置仓库错误规范化**：Kubernetes 的全部 Tauri 调用经统一 `invokeCommand` 将结构化 `AppError`
  归一化为用户可见错误；失效 SSH 引用在创建 / 更新时被拒绝，删除 SSH profile 时会保留 Kubernetes profile
  并明确提示其需要重新选择来源。
编辑器现可逐 context 测试：本机来源检查 API Server 版本、身份与 Pod 只读权限；远端来源经共享 SSH transport
检查 kubectl、API Discovery、身份与同类权限。测试结果按 context 返回，任一失败均不会阻止保存其他 context。
远端 kubeconfig 路径可通过复用 SSH 连接池的 SFTP 目录选择器定位；选择器只返回目录 / 文件的名称、路径和基础
元数据，绝不读取或向前端传输远端 kubeconfig 正文。
已打开工作区会在打开时及随后每 60 秒以只读方式重扫本机路径、系统凭据存储或远端 kubeconfig 的 context 摘要；
新增、消失或改名会显示提示，当前选择绝不自动切换。普通资源请求仍会独立显示网络 / 认证错误，不会被监测提示覆盖。

**Phase 1 验收**：macOS / Windows 可保存本地路径与导入文件；可通过一个 SSH profile 保存远端来源；一个含
多个 context 的配置可选择并测试多个 context，应用重启后非秘密配置正确恢复。

### Phase 2：统一只读 GUI MVP

**已完成记录**：已新增 Kubernetes Profile 的 SQLite 持久化、local / remote SSH 来源编辑器、系统文件选择、
远端 kubectl 自动发现、context 多选及连接管理入口。Phase 2 已提供同一套本机 `kube` client 与共享 SSH
transport 上受控 `kubectl -o json` 的只读列表 / 详情接口，以及 Pods、Deployments、Services、Events、
ConfigMaps、Secrets（仅 metadata、type 和 key 名）、Namespaces、Nodes 的 GUI 浏览。详情 YAML 为只读，
Secret 值在后端脱敏后才跨越 Tauri 边界；本机 API 列表支持 1–500 条的分页与 continue token，工作区支持
namespace / label selector、刷新、加载更多和资源详情。本机 client 以 kubeconfig 修改时间、路径和 context 为键
缓存，配置变更会自动创建新 client；工作区的已打开 context 子标签和自动刷新偏好会恢复，自动刷新当前以
10 秒轮询作为 Watch 不可用时的安全降级。本机 API Discovery 已获取聚合 API / CRD 资源清单并执行
SelfSubjectReview / SelfSubjectAccessReview；远端通过 `kubectl api-resources`、`auth whoami` 和 `auth can-i`
获取同类信息。权限矩阵现覆盖标准资源的 list / get / watch / create / patch / delete，以及 Pod 日志和 exec，
并明确区分允许、拒绝、API 不支持与检测失败；工作区显示当前身份和权限受限摘要。动态 CRD 已接入资源选择与详情查询；
远端显式 continue token 与服务端 Watch 已完成代码实现。Kubernetes 当前 context 已进入统一顶部标签条，可关闭回到
连接管理；多个 `profile + context` 顶部工作区可并存、独立关闭并恢复，资源、命名空间、标签筛选和自动刷新偏好
按工作区隔离保存。本机 API 已支持可取消的 DynamicObject Watch、bookmark、`410 Gone` 重置和重新建立流；
远端来源也通过共享 SSH transport 的独立 `kubectl --watch` channel 实时应用资源增删改，取消不会影响其他 channel；
两种来源都以轮询作为建连失败的降级。多个 context 的内部子标签仍会恢复。Watch 恢复的真实集群 / 网络抖动
验收完成前，本阶段仍不能视为验收完成。本机 client 继续以 kubeconfig 文件指纹隔离缓存；远端 channel 使用连接池
既有的并发限制、空闲回收和 transport 恢复机制，Watch 重建不会泄漏旧 channel。

**以下为剩余任务**：

- [ ] **K2.10 CRD 验收**：验证已接入动态资源选择 / 详情查询的 namespaced / cluster-scoped、版本切换和 CRD
  被动态添加 / 删除的行为。

**Phase 2 验收**：本地与远端来源在同一 GUI 中完成多 context 并行只读浏览；标准资源和至少一种 CRD 能实时
或降级刷新；低权限身份看不到可写入口；无 Token、客户端私钥或 Secret value 出现在前端载荷。

### Phase 3：Pod 日志与来源一致的 CLI

**已完成记录**：已提供受 2 MB 上限保护的 Pod 日志快照和真正的 follow operation：本机来源通过 Kubernetes API
流读取、远端来源通过共享 SSH transport 上的受控 `kubectl logs --follow` 通道读取；取消只关闭该日志 operation，
不影响共享 SSH transport、终端或其他功能。工作区支持多容器、tail、since、时间戳、上一实例、日志搜索与系统保存。
已提供“CLI”入口：Rust 根据 profile 来源、kubeconfig、context 和 namespace 构造并引用命令，前端仅创建既有
本地 / SSH 终端并写入该命令；不会改写 kubeconfig 的 `current-context`，CLI 关闭也不会关闭 Kubernetes 工作区。
CLI 会预检本机或远端 kubectl 并在不能确认时给出提示；真实多 context 验收仍未完成。

- [ ] **K3.5 多 context 验收**：同时打开两个 context 的日志和 CLI，确认输出、取消、标签标题和 namespace
  不串线。

### Phase 4：安全创建与修改资源

**已完成记录**：工作区使用独立的 `dssh-k8s://` Monaco YAML model、YAML language、编辑器设置继承和 dirty / 关闭
保护；模板、多文档对象摘要、大小与元数据预检查已接入。所有写入由后端重新执行 server dry-run，路径引用本机使用
Kubernetes API、远端使用 `kubectl --dry-run=server`，随后才允许显式确认的 Server-Side Apply。冲突支持 field manager
和二次确认的 force；失败保留 YAML。删除具备传播策略、resourceVersion precondition、逐项结果，Deployment / StatefulSet /
DaemonSet 提供扩缩容和滚动重启。SQLite 审计只保存来源、context、非秘密身份、资源摘要、动作、结果和错误码，并在工作区
提供审计查看入口；不会记录 kubeconfig、Token、Secret value 或完整 YAML。

- [x] **K4.1 Kubernetes Monaco 模型**：`dssh-k8s://` URI、YAML language、dirty / 关闭保护、主题和 context / resource 唯一性。
- [x] **K4.2 创建入口与模板**：空白 YAML、Pod、Deployment、Service、ConfigMap 模板，多文档预解析和逐对象摘要确认。
- [x] **K4.3 服务端 dry-run**：本机 API 与远端 kubectl 均在实际写入前执行 server dry-run，并展示校验 / admission 摘要。
- [x] **K4.4 Diff 与 Server-Side Apply**：显示服务端差异，使用 field manager；force conflict 必须二次确认。
- [x] **K4.5 删除语义**：传播策略、resourceVersion precondition、逐项成功 / 失败汇总。
- [x] **K4.6 受控快捷动作**：RBAC 门禁下的 scale 与 rollout restart，并在操作后刷新资源详情。
- [x] **K4.7 审计与脱敏**：后端记录非秘密审计字段，前端可按 context 查看记录。

**Phase 4 验收**：只读账号不能发出写请求；写账号可在本地与远端来源安全创建、修改和删除测试资源；冲突、
admission 拒绝、部分失败和断线不会丢失未保存 YAML，也不会误报成功。

### Phase 5：交互式运维与可靠性

**已完成记录**：Pod 详情提供 RBAC 门禁的 container / shell / TTY Exec 入口，并在来源一致的本机或远端终端中启动受控命令。
端口转发由独立 Kubernetes operation manager 管理，支持 Pod / Service、端口占用预检、任务列表、取消、完成 / 失败事件，
不复用 SSH forwarding 状态。Metrics API 不可用时返回安全降级结果；资源详情显示 owner references 与 selector，并明确
selector 只是推断关系。Watch、日志 follow、kubectl channel、端口转发都拥有独立取消令牌，SSH transport 恢复不会关闭其他
channel。Kubernetes 工作区已接入统一顶部标签、命令面板 context/CLI 动作和独立原生窗口；返回主窗口会恢复原标签，关闭
独立窗口不会丢失 profile/context。

- [x] **K5.1 Pod Exec**：container / shell / TTY 选择，来源一致的终端启动与独立会话。
- [x] **K5.2 端口转发**：Pod / Service、端口占用检查、任务列表、取消和状态事件；与 SSH 转发隔离。
- [x] **K5.3 指标**：Metrics API + RBAC 允许时显示 CPU / 内存，不可用时安全降级。
- [x] **K5.4 资源关系导航**：展示 owner references 与 selector matchLabels，区分确定与推断关系。
- [x] **K5.5 故障恢复**：Watch / 日志 / 端口转发独立 operation 取消和重建边界已实现；真实网络、凭据和 kubectl 替换仍需验收。
- [x] **K5.6 独立窗口与命令面板**：Kubernetes 标签可移至独立窗口，context / CLI 动作进入 ⌘K，沿用可配置快捷键体系。

### Phase 6：可选增强，不进入首版发布门槛

- [ ] **K6.1 Helm**：Release 列表、values、diff、安装、升级和回滚；单独评估本地 / 远端 Helm 二进制依赖。
- [ ] **K6.2 CRD Schema 表单**：使用 OpenAPI schema 生成辅助表单，YAML 始终作为最终真相。
- [ ] **K6.3 RBAC 分析**：Role / Binding 关系、`can-i` 矩阵和风险提示，不自动修改权限。
- [ ] **K6.4 多集群能力**：跨 context 只读搜索、资源差异和版本对比；禁止默认批量写入多个集群。
- [ ] **K6.5 Pod 文件传输**：评估 tar/exec 限制、容器工具缺失和安全性后另立规格。
- [ ] **K6.6 AI 辅助**：解释资源、日志与 Events，生成待审 YAML；写入、删除、exec 与端口转发继续使用显式审批。

### 发布前统一验证

- [ ] **KV.1 平台矩阵**：macOS / Windows 本地来源，以及至少一种远端 Linux SSH 来源。
- [ ] **KV.2 集群矩阵**：本地开发集群、标准远端集群、exec credential 云集群、标准资源和 CRD。
- [ ] **KV.3 权限矩阵**：只读、namespace 管理、cluster 管理和无权限账号。
- [ ] **KV.4 故障矩阵**：API / SSH 断开、Watch 过期、kubectl / 插件缺失、超时、冲突、部分失败与取消。
- [ ] **KV.5 安全检查**：前端事件、SQLite、日志、Toast、崩溃信息和 AI 上下文均不泄露凭据或 Secret value。
**最近工程验证记录**：本轮已通过 `pnpm exec tsc --noEmit`、`pnpm build`、`cargo fmt`、
`cargo clippy --all-targets -- -D warnings` 和 `cargo test`。发布构建前仍须按当时提交重新执行；Phase 0 / 2 / 3、
以及 Phase 5 的真实集群、平台和故障矩阵验收仍由 KV 条目跟踪。

## VNC 远程桌面工作区

> 状态：尚未开始。实施严格遵循 [VNC 远程桌面工作区规格](features/vnc-workspace.md) 的 Phase 0 → 1 → 2 → 3 → 4；Phase 5 为可选增强，不属于首版发布门槛。VNC 不能作为 SSH profile 的字段扩展，且不能把已保存 VNC 密码下发给 WebView。

### Phase 0：协议、桥接与安全门禁

- [ ] **V0.1 RFB / noVNC 兼容性 spike**：锁定候选 @novnc/novnc 版本与 MPL-2.0 合规方式，在 Tauri macOS / Windows WebView 创建最小 RFB renderer；核对 noVNC 的 WebSocket、resize、clipboard、view-only、键盘和卸载 API，记录最小浏览器 / WebView 版本与打包体积变化。
- [ ] **V0.2 Rust RFB 握手 spike**：针对受控 TigerVNC / QEMU fixture 实现或审计 RFB 3.3 / 3.7 / 3.8 版本协商、None、经典 VNC Authentication、ClientInit / ServerInit、错误 reason、取消和读取长度限制；用字节级 golden test 覆盖部分读写与畸形报文。不得以长期无人维护 crate 作为未经审计的唯一安全边界。
- [ ] **V0.3 本地 RFB bridge spike**：验证 Rust 在远端认证完成后，可向 noVNC 暴露仅本次会话的本地 None RFB 握手并透明 relay 已建立流量；证明 noVNC 不需要取得远端密码，desktop 初始化、SetPixelFormat、SetEncodings、输入和 framebuffer update 均能正常工作。
- [ ] **V0.4 回环 capability 安全 spike**：实现临时 127.0.0.1 / ::1 listener、密码学随机且一次性的 capability、受控 Origin、连接 / 握手超时、单 renderer 限制和关闭清理；覆盖 token 重放、错误 Origin、第二客户端、超时与日志脱敏。不得暴露通用 LAN WebSocket-to-TCP proxy。
- [ ] **V0.5 SSH tunnel spike**：为 SSH connection pool 增加 Vnc channel owner，验证从已认证 transport 打开 direct-tcpip 到网关视角的 VNC target；覆盖并发终端 + SFTP + VNC、target 不可达、host-key 提示 / 变更、channel 限额与关闭 VNC 后仅释放其 lease。
- [ ] **V0.6 凭据与许可证门禁**：先完成或最小接入系统 SecretStore，使 VNC password 不会落入普通 SQLite；定义清除、引用计数、导入导出和 zeroize 规则。完成 noVNC 及新增 Rust 依赖的许可证、供应链、跨平台构建和 NOTICE 审查。

**Phase 0 验收**：在 macOS 和 Windows 各连接一个受控 VNC server，画面和输入正常，保存密码没有进入前端 / SQLite / 日志；经 SSH 隧道能与现有 terminal / SFTP 并存；关闭 renderer / 标签会收回 listener、capability 与 channel。任一项不成立时，不进入正式 profile 或凭据保存开发。

### Phase 1：安全的连接模型与 VNC MVP

- [ ] **V1.1 独立 VNC profile 与迁移**：新增 vnc_profiles migration、Rust / TypeScript DTO、独立 repository 和 CRUD；字段覆盖名称、SSH tunnel 或 direct TCP、target host / port、None 或 VNC password、shared、默认只读、收藏、标签和描述。保留现有数据库和 SSH / Kubernetes profile 兼容性。
- [ ] **V1.2 SecretStore、删除与配置文件**：实现 VNC password 的创建、更新保持、显式清除和删除清理；普通 YAML 预览遮罩、加密导出 / 导入含 VNC profile，并升级 document version 而不破坏旧格式。安全存储不可用时拒绝保存密码，不回退到明文表。
- [ ] **V1.3 VncManager 与传输**：新增进程内 session registry、direct TCP 与 SSH direct-tcpip transport、RFB handshake、短时 bridge、状态事件、连接 / 读写超时、取消与确定性资源释放。direct TCP 仅作为显式确认后的受限模式：禁用自动重连和默认剪贴板同步。
- [ ] **V1.4 命令与服务层**：注册 list / create / update / delete / favorite / test VNC profile，以及 start / close / reconnect / list VNC session 命令；所有载荷 camelCase，经 invokeCommand 规范化 AppError。start 只返回不可持久化 renderer descriptor，前端不拼接 token 或读取 secret。
- [ ] **V1.5 连接管理接入**：在 connectionTypes、SessionManager、新建菜单、类型筛选、搜索、最近、收藏和卡片中接入 VNC；增加 VncProfileEditor，清晰区分直连与“通过 SSH profile”目标，测试连接仅显示非敏感 RFB 摘要。
- [ ] **V1.6 VNC 标签工作区**：新增 useVncSessions、VncWorkspace、VNC 服务层和 monitor tab kind；以 noVNC 挂载 renderer，支持连接、断开、手动重连、状态 / 错误空态和适配窗口缩放。VNC 不进入 PaneGrid，终端 split 操作在 VNC 标签激活时不可用。

**Phase 1 验收**：可保存并编辑 SSH tunnel VNC profile；以 None 和 VNC password 各连接一个受控服务器，打开两个 VNC 标签，与 SSH terminal / SFTP 同时运行；关闭任何 VNC 标签不影响 SSH transport 上其他 channel；直接 TCP 的风险确认、错误提示和无密码泄露均可验证。

### Phase 2：日常交互与工作区一致性

- [ ] **V2.1 视图与输入控制**：实现适合窗口 / 100% 缩放、裁剪、全屏、重新捕获键盘、刷新画面、Ctrl-Alt-Del、shared 与会话内 view-only；view-only 必须在客户端阻断键盘 / 指针上行并有明显状态标识。
- [ ] **V2.2 剪贴板安全交互**：分别实现“远端 → 本机”和“本机 → 远端”的显式开关、权限与用户手势处理；默认关闭，正文只在内存短暂存在，不写 localStorage、历史、日志或 AI 上下文。
- [ ] **V2.3 会话树与命令面板**：在活动会话侧栏增加独立 VNC 桌面分组，提供显示、只读、重连、断开动作；在 ⌘K 增加适用 VNC 动作，并保证 AI 只能调用显示 / 只读等无副作用界面控制。
- [ ] **V2.4 独立窗口**：扩展 DetachedWorkspace 模型、manager、capability 与前端以支持 detached-vnc-*；窗口移动、回归主窗口、关闭标签、renderer 重新挂载和焦点切换均保留或正确关闭 VncSession，且完整重启 Tauri 验证 capability。
- [ ] **V2.5 交互回归**：真实验证 macOS / Windows 的键盘修饰键、输入法、触控板、DPI、窗口缩放、全屏、深浅主题、隐藏恢复、快速开关标签和 renderer 卸载，修复 WebSocket / canvas / listener 泄漏。

**Phase 2 验收**：VNC 在主窗口和独立窗口间切换后仍可安全交互；只读与两个方向的剪贴板权限均遵守设置；VNC 相关控制不会影响终端 / SFTP 的标签、分屏或快捷键。

### Phase 3：加密直连与服务器身份验证

- [ ] **V3.1 VeNCrypt TLS 测试矩阵**：在受控 TigerVNC / QEMU 环境验证 TLSNone、TLSVnc、TLSPlain、X509Vnc 等实际提供的安全类型，确定首批支持集、TLS 版本、cipher、协议 fallback 和不支持错误；没有完整证据的厂商类型不得暴露为可用选项。
- [ ] **V3.2 TLS 实现与证书策略**：在 Rust 侧实现 TLS / VeNCrypt 协商，使用系统根证书或用户选择的 CA，验证 hostname、链和有效期；自签名证书首次显示 SHA-256 指纹并建立 pin，变更时硬失败。SSH known_hosts 与 X.509 信任记录必须隔离。
- [ ] **V3.3 Direct TCP 发布门禁**：将 direct TCP 的可用性与安全方式绑定：无 TLS 或仅 VNC password 时每次显式确认并显示受限状态；TLS 验证通过后才启用完整直连体验。不得因服务器协商失败而退回明文 / 弱认证。
- [ ] **V3.4 认证与证书数据生命周期**：补齐 username / password 在安全类型适用时的临时输入和 SecretStore 引用，零化挑战、密码、私钥和会话能力；补齐更新、导出、导入、删除、证书替换及错误日志的回归测试。

**Phase 3 验收**：对受信任 CA、自签名首次 pin、证书变更、hostname 不匹配、过期证书、仅弱安全类型和认证失败分别得到正确结果；任何失败均不能降级到未验证直连或泄露秘密。

### Phase 4：恢复、性能与发布验证

- [ ] **V4.1 断线与重连策略**：为 SSH tunnel 与直连分别实现受用户控制的指数退避重连、取消、认证失败停止、最大次数和明确 UI 状态；不得因为网络抖动高频重放密码造成服务器锁定。
- [ ] **V4.2 资源与可观测性**：实现非敏感会话计数、bridge / SSH channel 关闭指标、内存与 listener 诊断，覆盖后台 / 恢复、目标重启、网关断线、DNS / timeout、服务器 resize、反复 renderer 重建与进程退出。
- [ ] **V4.3 互操作与性能矩阵**：在 TigerVNC、QEMU / libvirt 与 x11vnc 等至少三类受控服务器上验证 RFB 3.3 / 3.8、常见 encoding、1080p、网络高延迟、窗口 resize 与键盘输入；记录帧率、CPU、内存和连接耗时基线。
- [ ] **V4.4 端到端安全审计**：审计 Tauri command / event、SQLite、SecretStore、crash error、Toast、前端 console、AI tool、配置导入导出和依赖 NOTICE；确认密码、RFB 帧、clipboard 正文、certificate 私钥、bridge URL 与 token 不可见。
- [ ] **V4.5 CI 与发布验证**：增加 Rust unit / integration 测试和前端组件测试；在 macOS / Windows 完成 pnpm exec tsc --noEmit、pnpm build、cargo fmt、cargo clippy --all-targets -- -D warnings 与 cargo test，并在当次发行构建重新执行真实 VNC 矩阵。

**Phase 4 验收**：所有支持路径的连接、关闭、网络故障、认证失败与恢复不会泄漏资源或敏感数据；跨平台真实服务器矩阵通过后，VNC 才能从试验功能进入发布功能。

### Phase 5：可选增强，不进入首版发布门槛

- [ ] **V5.1 VNC Repeater**：评估并实现独立的 repeater ID / host 路由模型；它不能复用或暴露本地 bridge token。
- [ ] **V5.2 额外认证类型**：在安全与互操作验证后按需支持 RealVNC RSA-AES、Apple Diffie-Hellman、Tight / UltraVNC 特定认证；每种类型独立记录许可证、secret 形态、协商与降级策略。
- [ ] **V5.3 Server capability 优化**：ContinuousUpdates、Fence、ExtendedDesktopSize、质量 / encoding 提示等仅在后端和 noVNC 两侧均已验证时启用，并能回退到标准帧更新。
- [ ] **V5.4 受控导入**：单独设计 .vnc、.tigervnc 或厂商 profile 的导入映射、危险字段过滤、密码处理和预览脱敏；不执行导入文件内的命令或外部引用。
- [ ] **V5.5 录制与审计探索**：如有合规需求，先定义用户可见状态、加密存储、保留期、磁盘配额和敏感屏幕数据告知，再评估录制，不复用 websockify 的流量记录功能。
