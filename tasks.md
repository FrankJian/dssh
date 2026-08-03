# Duo SSH 实施任务

> 本文件记录已经完成规格评审、可以按阶段实施的任务。高层优先级与其他未排期事项见
> [`TODO.md`](TODO.md)，当前界面约定见 [`spec.md`](spec.md)，Kubernetes 完整规格见
> [`features/kubernetes-workspace.md`](features/kubernetes-workspace.md)。完成的任务应及时删除或压缩为简短记录，
> 避免与仍需实施的步骤混杂。

## Kubernetes 集群工作区

> 状态：Phase 0–3 的代码基础已完成，仍需真实集群验收。实施顺序必须遵循 Phase 0 → 1 → 2；Phase 3 和 4 可在只读 MVP 稳定后顺序推进，
> Phase 5 依赖长任务取消和重连验收，Phase 6 不属于首版承诺。

### Phase 0：剩余技术预研与安全门禁

- [ ] **K0.1 依赖与版本矩阵**：验证当前稳定 Rust `kube` / `k8s-openapi` 与项目 Tokio、rustls、Tauri 依赖的
  兼容性，确定最低 / 最高 Kubernetes 服务端版本，记录 crate feature 和二进制体积变化。
- [ ] **K0.2 本地 kubeconfig spike**：覆盖默认配置、`KUBECONFIG` 多路径、手工路径、无扩展名文件、多个
  context、client certificate、bearer token 和 exec credential plugin；确认解析、刷新与错误分类。
- [ ] **K0.3 远端 kubectl spike**：在现有 SSH 连接池 channel 上验证版本探测、context 列表、API Discovery、
  `get -o json`、Watch、日志、stdin dry-run/apply、取消、超时与 transport 恢复。
- [ ] **K0.4 命令安全验收**：补充真实远端环境下的注入回归测试，覆盖路径、context、namespace 和资源名中的空格、
  Unicode、引号及恶意输入；禁止前端传完整命令字符串。
- [ ] **K0.5 kubeconfig 信任模型**：为本地 exec plugin 显示可执行文件、来源、参数摘要和信任确认；设计允许列表、
  撤销信任、环境变量过滤与敏感输出脱敏。
- [ ] **K0.6 导入文件安全门禁**：确定 app-managed kubeconfig 的加密 / 系统钥匙串存储、迁移、备份和删除语义。
  未通过评审前只允许自动发现、路径引用和一次性导入，不允许明文持久化。
- [ ] **K0.7 后端抽象定稿**：用 spike 验证统一 `KubernetesBackend` 能覆盖本地 API 和远端 kubectl，定稿 DTO、
  operation id、取消、Watch / 轮询降级和错误码。

**已完成记录**：已引入并编译 `kube` / `k8s-openapi`；Rust 后端已提供本机 kubeconfig 扫描，以及经共享
SSH transport 的远端 kubectl / kubeconfig 自动发现命令。扫描结果仅包含 context、cluster、user、namespace 和
路径摘要；远端动态参数使用统一 POSIX 单引号转义，exec 输出增加上限。以下条目仅保留真实本地 / 远端集群、
exec plugin、版本矩阵与取消 / 重连场景的验收或尚未实现的安全设计。

**Phase 0 验收**：本地与远端各完成一个多 context 集群的只读查询；没有凭据进入前端或日志；明确列出暂不兼容
的认证插件、kubectl / 服务端版本和平台差异后，才能进入持久化开发。

### Phase 1：连接模型、来源与多 context

**已完成记录**：已完成 `kubernetes_profiles` 迁移、Rust / TypeScript DTO 与 CRUD、连接类型入口、local / remote
来源编辑器、系统文件选择、远端 kubectl 自动发现、context 扫描和多选，以及连接管理页的标签分组与类型筛选。

- [ ] **K1.3 配置仓库加固**：补齐失效 SSH 引用检测、删除 SSH profile 时的提示语义和错误规范化；不得级联删除
  Kubernetes profile。
- [ ] **K1.5 本地来源补齐**：完善引用 / 导入语义、多文件 `KUBECONFIG` 摘要、`~` 与平台路径列表，以及不存在 /
  无权限文件的用户提示。
- [ ] **K1.6 远端来源补齐**：接入仅用于选择路径的 SFTP 浏览器；不把远端 kubeconfig 文件内容下载到前端。
- [ ] **K1.8 测试连接**：逐 context 返回 SSH / kubectl / API / 认证 / 版本 / 身份 / RBAC 状态；部分 context
  失败不阻止保存其他有效 context。
- [ ] **K1.9 配置变化处理**：引用文件或远端配置变化后重新扫描，展示新增 / 删除 / 改名结果；已打开工作区不得
  静默切到另一个 context。

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
获取同类信息，工作区显示当前身份和读权限受限状态。动态 CRD 已接入资源选择与详情查询；远端显式 continue token、
服务端 Watch、完整 RBAC 动作矩阵尚未完成。Kubernetes 当前 context 已进入统一顶部标签条，可关闭回到
连接管理；多个 context 的内部子标签仍会恢复。服务端 Watch 与上述动态资源 / 权限矩阵完成前，本阶段仍不能
视为验收完成。

**以下为剩余任务**：

- [ ] **K2.1 客户端管理器加固**：补齐远端 kubectl session 的并发、空闲回收和关闭语义，并验证本机 client
  fingerprint / credential generation 失效策略。
- [ ] **K2.2 本地 API Watch**：为标准资源、聚合 API 与 DynamicObject 完成服务端 Watch、取消和结构化 AppError。
- [ ] **K2.3 远端 kubectl 分页与 Watch**：补齐显式 continue token、长任务取消和 Watch / 轮询降级的行为验证。
- [ ] **K2.5 完整 RBAC 动作矩阵**：扩展现有身份与只读权限检测，分别展示无权限、API 不支持与请求失败。
- [ ] **K2.6 顶部工作区收口**：实现真正可并存、独立关闭和恢复筛选状态的 `profile + context` 顶部工作区标签。
- [ ] **K2.9 Watch 恢复**：处理断线、`410 Gone`、context 配置变化、远端 SSH 重连和 API 认证刷新；重新 list
  时保持用户选择，禁止重复 Watch 泄漏。
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

- [ ] **K4.1 Kubernetes Monaco 模型**：新增 `dssh-k8s://` model URI、YAML language、dirty / 关闭保护、
  深浅主题和 context / resource 唯一性；不复用 SFTP 保存接口。
- [ ] **K4.2 创建入口与模板**：提供空白 YAML、Pod、Deployment、Service、ConfigMap 等基础模板；支持多文档
  预解析并逐对象确认，不承诺跨对象事务。
- [ ] **K4.3 服务端 dry-run**：本地 API 与远端 kubectl 都必须先执行 server dry-run，显示 validation、admission、
  默认字段、managed fields 冲突和最终对象摘要。
- [ ] **K4.4 Diff 与 Server-Side Apply**：显示当前 / 目标差异、field manager 和冲突；force conflict 使用独立
  二次确认，失败保留编辑内容。
- [ ] **K4.5 删除语义**：实现单项 / 批量确认、Foreground / Background / Orphan 传播策略和 precondition；
  逐项汇总成功、失败和未处理项。
- [ ] **K4.6 受控快捷动作**：实现 Deployment scale、rollout restart / status，必要时支持删除并重建 Pod；
  每项都经过 RBAC、dry-run（适用时）和明确反馈。
- [ ] **K4.7 审计与脱敏**：记录来源、context、身份、资源、动作和结果，不记录 kubeconfig、Token、Secret value
  或完整敏感 YAML。

**Phase 4 验收**：只读账号不能发出写请求；写账号可在本地与远端来源安全创建、修改和删除测试资源；冲突、
admission 拒绝、部分失败和断线不会丢失未保存 YAML，也不会误报成功。

### Phase 5：交互式运维与可靠性

- [ ] **K5.1 Pod Exec**：支持 container / shell 选择、TTY、stdin/stdout/stderr、终端尺寸和退出状态；本地 API 与
  远端 kubectl exec 提供一致的终端体验。
- [ ] **K5.2 端口转发**：支持 Pod / Service 目标、本地端口冲突检测、任务列表、取消与重连；不得与 SSH 端口
  转发状态混淆。
- [ ] **K5.3 指标**：在 Metrics API 可用且 RBAC 允许时显示 Node / Pod CPU、内存；不可用时安全降级，不直接
  抓取高权限组件 metrics endpoint。
- [ ] **K5.4 资源关系导航**：以 owner references 和 selector 建立受限关系导航，避免把推断关系展示成确定关系。
- [ ] **K5.5 故障恢复**：覆盖本地网络切换、Token 刷新、exec plugin 失败、SSH transport 重连、kubectl 被替换、
  context 删除和长任务取消。
- [ ] **K5.6 独立窗口与命令面板**：只读和写操作稳定后再接入 Kubernetes 工作区独立窗口、⌘K context 动作和
  可配置快捷键。

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
`cargo clippy --all-targets -- -D warnings` 和 `cargo test`。发布构建前仍须按当时提交重新执行。
