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
