# Kubernetes 集群工作区规格

> 状态：Phase 0–5 的代码基础已完成，仍需真实集群、平台、权限和故障矩阵验收；Phase 6 为可选增强。本文定义 Kubernetes
> 连接、资源 GUI 与 CLI 工作流的产品边界、双来源架构、安全要求和分阶段交付顺序。具体实施清单见
> [`../tasks.md`](../tasks.md)，优先级入口见
> [`../TODO.md`](../TODO.md)。

## 1. 目标与非目标

### 1.1 目标

- 在连接管理中新增独立的 `Kubernetes` 类型，不把 Kubernetes 字段塞进 `SshProfile`。
- 同时支持**本地来源**和**远端来源**：
  - 本地来源直接从当前电脑读取 kubeconfig，并由 Rust Kubernetes 客户端访问 API Server。
  - 远端来源先复用已有 SSH profile 连接 Linux 主机，再使用远端 kubeconfig 与远端 `kubectl`。
- 同时支持手工输入 kubeconfig 路径、通过系统文件选择器选择文件，以及把文件导入应用管理。
- 一个 kubeconfig 中的全部 context 都可被发现；用户可保存、打开和同时使用多个 context，而不是只支持
  `current-context`。
- 通过统一 GUI 浏览、查询和安全修改标准资源与 CRD，并提供与所选来源一致的 CLI 工作流。
- 复用现有 Monaco、终端、标签条、SSH 连接池、Toast / 确认框和 Violet / Nebula 视觉体系。

### 1.2 非目标

- 不重新实现一个完整的 `kubectl`，也不承诺完全替代 Lens、OpenLens 或 Kubernetes Dashboard。
- 首版不包含 Helm、集群安装升级、云厂商账号管理、Prometheus 全功能图表和多集群编排。
- 不自动提升 Kubernetes 权限；GUI 必须遵守当前 context 对应身份的 RBAC。
- 不把远端 kubeconfig、Token、客户端私钥或 exec credential 结果下发给前端。
- 远端来源首版不尝试把远端 kubeconfig 拉到本地后直连 API Server；远端文件引用、认证插件和网络可达性
  都应留在远端执行环境。

## 2. 核心概念

### 2.1 连接配置、context 与工作区

- **Kubernetes profile**：Duo SSH 保存的逻辑配置，包含显示名称、来源、kubeconfig 引用、可用 context、
  默认 namespace、标签和描述。
- **Context descriptor**：从 kubeconfig 发现的非秘密元数据，至少包含 context 名、cluster 名、user 名、
  默认 namespace 和来源标识。
- **Cluster workspace**：`profile + context` 对应的独立标签页。不同 context 有独立的 namespace、资源筛选、
  Watch、日志与 CLI 状态。
- **Source**：执行 Kubernetes 操作的位置，固定为 `local` 或 `remoteSsh`。它不是 context 的属性，不能在
  已打开工作区中静默切换。

一个 profile 可以选择多个 context。活动会话中显示为父子结构：

```text
▾ production-kubeconfig                         3
  ├─ ● prod-cn                                  default
  ├─ ● prod-us                                  platform
  └─ ○ staging                                  default
```

打开多个 context 时创建多个工作区标签，例如 `prod-cn · Pods`、`staging · Deployments`；关闭一个 context
工作区不影响同一 profile 的其他 context。

### 2.2 kubeconfig 输入方式

本地来源提供三种方式：

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| 自动发现 | 使用 `KUBECONFIG`，未设置时使用 `~/.kube/config` | 常规本机 kubectl 环境 |
| 引用路径 | 手工输入路径，或通过文件选择器选择但不复制；连接时重新读取 | kubeconfig 会被外部工具更新 |
| 导入文件 | 选择一个或多个文件；Rust 合并并直接保存到系统凭据存储 | 原文件可能被移动、临时下发或需要应用独立管理 |

约束：

- 路径输入支持绝对路径、`~` 展开和平台原生 `KUBECONFIG` 路径列表；规范化与读取仅在 Rust 侧完成。
- 文件选择器至少允许无扩展名、`.yaml`、`.yml` 和 `.config`，不能只按扩展名判断有效性。
- 导入后 SQLite 仅保存随机 secret reference、文件显示名和用于同内容复用的 SHA-256 指纹；正文直接进入 macOS
  Keychain、Windows Credential Manager 或 Linux Secret Service。安全存储不可用时导入失败，绝不回退到 SQLite
  明文。
- 导入型 kubeconfig 仅接受内嵌的 CA、客户端证书 / 私钥或 Token。`certificate-authority`、
  `client-certificate`、`client-key`、`tokenFile` 等外部敏感文件引用会被拒绝；用户可改用路径引用模式。
- 编辑取消、来源替换和删除 profile 都要清理未引用的 secure-store entry；导入内容、Token、client key 和
  exec 输出均不得离开 Rust。已导入来源不能用“打开 CLI”将配置写入终端环境。
- 多文件不通过前端拼接 YAML。自动发现遵循 Kubernetes 的合并语义；显式添加的多个文件在 UI 中保留
  独立 source id，context 主键使用 `sourceId + contextName`，避免同名覆盖。

远端来源提供：

| 模式 | 行为 |
| --- | --- |
| 自动发现 | 通过已选 SSH profile 查找远端 `kubectl`、`KUBECONFIG`、`~/.kube/config` 与少量常见 Linux 路径，再扫描所有 context |
| 远端默认环境 | 让远端 `kubectl` 使用其默认 `KUBECONFIG` / `~/.kube/config` |
| 远端路径 | 用户输入远端路径，或通过现有 SFTP 文件选择器定位 kubeconfig |

远端路径由远端 shell / kubectl 解释，不能先按本机路径规则规范化。应用保存 SSH profile 引用和路径文本，
不保存远端文件内容。

远端路径选择器复用该 SSH profile 的共享 SFTP channel，只列出目录 / 文件名称、路径与基础元数据。选择文件仅将其
路径带回编辑器；禁止通过该选择器读取、预览、下载或缓存 kubeconfig 正文。

自动发现只检查远端非交互环境中的 `PATH`、`KUBECONFIG`、`$HOME/.kube/config`、
`/etc/kubernetes/admin.conf`、K3s 与 RKE2 的常见配置位置；不得递归扫描磁盘、自动使用 `sudo` 或读取
kubeconfig 正文。若非交互 shell 的 `PATH` 与用户登录环境不同，用户可手工覆盖 kubectl 路径。

## 3. 双来源架构

### 3.1 能力矩阵

| 能力 | 本地来源 | 远端来源 |
| --- | --- | --- |
| GUI API | Rust `kube` client 直连 API Server | 经共享 SSH transport 执行远端 `kubectl -o json` |
| kubeconfig | 自动发现、路径引用、导入文件 | 远端默认环境或远端路径 |
| context 发现 | Rust 解析 kubeconfig | `kubectl config get-contexts` 等受控命令 |
| GUI 查询与修改 | Kubernetes API | 远端 kubectl 的结构化 JSON / YAML 输入输出 |
| CLI | 本机终端 + 本机 kubectl | 目标 SSH 主机上的远端终端 + 远端 kubectl |
| kubectl 依赖 | GUI 不依赖；CLI 需要 | GUI 与 CLI 首版都需要 |
| 网络路径 | 本机 → API Server | 本机 → SSH 主机 → API Server |
| 认证插件 | 在本机执行 | 在远端执行 |

两种来源通过统一后端接口向前端提供规范化 DTO，前端不得根据来源拼接 kubectl 命令：

```rust
trait KubernetesBackend {
    async fn discover(&self) -> Result<DiscoverySnapshot>;
    async fn list(&self, query: ResourceQuery) -> Result<ResourcePage>;
    async fn get(&self, key: ResourceKey) -> Result<ResourceDocument>;
    async fn watch(&self, query: ResourceQuery, operation_id: String) -> Result<()>;
    async fn dry_run_apply(&self, request: ApplyRequest) -> Result<ApplyPreview>;
    async fn apply(&self, request: ApplyRequest) -> Result<ResourceDocument>;
    async fn delete(&self, request: DeleteRequest) -> Result<DeleteResult>;
}
```

Rust 可按项目风格拆为：

```text
src-tauri/src/kubernetes/
├── models.rs
├── profile_repository.rs
├── manager.rs
├── local_api.rs
├── remote_kubectl.rs
├── discovery.rs
├── permissions.rs
├── watcher.rs
├── logs.rs
├── exec.rs
└── port_forward.rs
```

### 3.2 本地 API 后端

- 使用 Rust `kube` / `k8s-openapi`，不从 WebView 直接请求 API Server。
- 客户端缓存键至少包含 `profileId + source fingerprint + context + credential generation`；不同 context 不得
  误用同一认证配置。
- 使用 API Discovery 和 `DynamicObject` 支持标准资源、聚合 API 与 CRD。
- list 后使用 `resourceVersion` 建立 Watch；断线、`410 Gone`、认证刷新和 context 配置变化后重新 list/watch。
- kubeconfig 的 exec credential plugin 只在 Rust 侧执行。首次遇到新可执行文件时显示命令、路径与来源并要求
  信任；信任按配置来源、context、用户、命令和参数的指纹持久化并可撤销。内嵌环境变量仅允许少量非秘密的
  位置 / 配置选择器，认证加载错误和插件输出必须脱敏。

### 3.3 远端 kubectl 后端

- 必须通过现有 `SshConnectionPool` 获取 channel，沿用 SSH TOFU、代理、连接恢复和 channel 限额；禁止另建
  跳过校验的 SSH 连接。
- 保存项包含 `sshProfileId`、远端 kubeconfig 模式 / 路径、可选 `kubectlPath` 和 context 选择，不包含 SSH
  凭据副本。
- 连接测试分别检查：SSH 可用、kubectl 可执行、客户端版本、context 存在、API Server 可达和身份/RBAC。
- 自动发现成功后展示每个候选 kubeconfig 的路径、context、cluster、user 与默认 namespace；同名 context
  使用“远端路径 + context 名”消歧。发现失败不覆盖已保存的手工路径。
- 所有 GUI 命令由 Rust 白名单命令构造器产生；profile、路径、context、namespace 和资源名作为经过验证的
  参数处理。前端不能传入完整 shell 字符串。
- 查询只接受稳定的结构化输出；不得解析人类表格。写入通过 stdin 传递 YAML/JSON，不能把内容插入命令行。
- Watch、日志和长命令有 operation id、取消令牌、超时与最大输出限制；SSH transport 恢复后按各自语义重建。
- 如果远端只有 kubeconfig 而没有 kubectl，首版明确报告能力缺失，不静默回退到下载 kubeconfig或本地直连。

### 3.4 CLI 语义

- 本地来源的“打开 CLI”启动本地终端，使用选定 kubeconfig 与 context；先检测本机 kubectl 并显示版本。
- 远端来源的“打开 CLI”在所选 SSH profile 下新建远端终端，使用同一远端 kubeconfig 与 context。
- CLI 环境只作用于新开的终端，不修改 kubeconfig 的全局 `current-context`；UI context 切换也不能调用
  `kubectl config use-context` 改写用户文件。
- CLI 标签显示来源，例如 `kubectl · prod-cn` 或 `kubectl@bastion · prod-cn`。
- GUI 使用的 context 和 CLI 初始 context 必须一致；用户在 CLI 内自行切换 context 不反向修改 GUI。

## 4. 数据模型与持久化

建议使用独立表和 DTO，不扩展 `ssh_profiles`：

```ts
type KubernetesSource =
  | {
      type: "local";
      kubeconfig:
        | { mode: "auto" }
        | { mode: "path"; paths: string[] }
        | { mode: "imported"; secretRef: string; displayNames: string[] };
    }
  | {
      type: "remoteSsh";
      sshProfileId: string;
      kubeconfig:
        | { mode: "remoteDefault" }
        | { mode: "remotePath"; path: string };
      kubectlPath?: string;
    };

interface KubernetesProfile {
  id: string;
  name: string;
  source: KubernetesSource;
  selectedContexts: Array<{ sourceId: string; name: string }>;
  defaultContext?: { sourceId: string; name: string };
  namespaceByContext: Record<string, string>;
  favorite: boolean;
  tags: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}
```

- SQLite 只保存非秘密配置和后端 secret reference；原始 kubeconfig、Token、client key、exec 输出不序列化给前端。
- 删除或改名被引用的 SSH profile 时，远端 Kubernetes profile 进入“来源失效”状态并允许重新选择，不能级联
  删除 Kubernetes profile。
- 引用路径每次连接重新读取，并以安全元数据通知用户 context 增删；已消失 context 的工作区停止重连并给出
  可修复错误。
- 已打开工作区在打开时和每 60 秒重扫来源的 context 摘要。新增、删除与改名只产生提示，绝不自动替换当前
  context；来源暂时不可读时保留最近一次有效提示，并由具体资源请求展示网络或认证错误。
- namespace 以 context 为单位保存；空值表示遵循该 context 的默认 namespace，仍为空时使用 `default`。

## 5. 界面与工作流

### 5.1 新建连接

连接类型筛选增加 `Kubernetes`。编辑器按以下顺序展示：

1. 名称、标签和描述。
2. 来源：`本机` / `远端服务器`。
3. 本机：自动发现 / 路径 / 导入文件；远端：SSH 连接 / 默认环境或路径 / kubectl 路径。
4. “扫描配置”按钮，列出所有 context、cluster、user、默认 namespace 和可用状态。
5. context 多选、默认 context 和每个 context 的 namespace。
6. “测试连接”，逐 context 展示身份、服务端版本、权限或错误。

扫描只返回非秘密摘要。切换来源会清空不适用字段，但在用户保存前保留可撤销的表单快照。

### 5.2 集群工作区

```text
┌─────────────────────────────────────────────────────────────────┐
│ prod-cn  [Namespace: default] [搜索] [自动刷新] [CLI] [创建]    │
├────────────────┬────────────────────────┬───────────────────────┤
│ 资源导航        │ 资源列表                │ 详情 / YAML / 日志     │
│ Workloads       │ Name Status Ready Age  │ Overview               │
│ Network         │ ...                    │ YAML (Monaco)           │
│ Config          │                        │ Events / Logs           │
│ Storage         │                        │                        │
│ Access          │                        │                        │
│ CRD             │                        │                        │
└────────────────┴────────────────────────┴───────────────────────┘
```

- 资源导航可按 API group / kind 搜索；区分 namespaced 与 cluster-scoped 资源。
- 首版标准资源包含 Namespace、Node、Pod、Deployment、StatefulSet、DaemonSet、ReplicaSet、Job、CronJob、
  Service、Ingress、ConfigMap、PVC 和 Event。
- 资源列表支持标签选择器、字段选择器、状态筛选、排序、分页和手动刷新；支持时以 Watch 实时更新。
- 详情提供 Overview、YAML、Events；Pod 额外提供 Logs、Exec 和端口转发入口（均受当前 RBAC 权限门禁）。
- YAML 编辑复用 Monaco，但 model URI 使用独立的 `dssh-k8s://<profile>/<context>/<gvk>/<namespace>/<name>`。
- 工作区、日志和 CLI 标签进入统一标签条；Kubernetes 工作区可移入独立原生窗口，关闭或合并时保留
  `profile + context` 标签关系，独立窗口关闭 / 合并也会检查未保存 YAML。

## 6. 修改、权限与安全边界

- 使用 `SelfSubjectAccessReview` / `SelfSubjectRulesReview` 判断当前身份可执行的动作；前端据此禁用操作，后端
  提交前仍执行真实请求并处理 RBAC / admission 拒绝。
- 创建和编辑默认流程为：YAML 校验 → 服务端 dry-run → 展示差异 / 默认值 / 冲突 → 用户确认 →
  Server-Side Apply。
- 删除显示 kind、namespace、name、传播策略和受影响范围；批量删除逐项报告，不伪造事务语义。
- Secret 默认只显示 metadata、type 和 key 名，不返回 value；显式查看 Secret 不进入首版。
- ConfigMap 可编辑；ServiceAccount Token、证书、kubeconfig 和命令输出必须经过统一脱敏。
- 远端命令和 Kubernetes 写操作进入通知 / 审计记录，但记录中不得出现凭据或 Secret 内容。
- AI 助手首版只可解释资源与生成待审 YAML；任何 apply、delete、exec、port-forward 都走与人工操作相同的
  显式审批，不能获得旁路权限。

## 7. 分阶段范围

### Phase 0：架构与安全验证

- 验证 Rust kubeconfig、exec plugin、Discovery、Watch、日志与 Server-Side Apply。
- 在真实远端 Linux 上验证 kubectl JSON、Watch、stdin apply、取消和 SSH 重连。
- 确认导入型 kubeconfig 的安全存储方案；未满足时只开放自动发现和路径引用。

### Phase 1：连接模型与多 context

- Kubernetes profile CRUD、类型筛选、标签分组和数据库迁移。
- 本机自动发现 / 路径 / 文件导入，以及远端 SSH / kubeconfig / kubectl 配置。
- context 全量发现、多选、默认 context、逐 context namespace 和测试连接。

### Phase 2：只读 GUI MVP

- 本地 API 与远端 kubectl 统一后端。
- 标准资源 / CRD Discovery、列表、详情、YAML、Events、RBAC 能力检测。
- 手动刷新、Watch / 轮询降级、错误恢复和多 context 并行工作区。

### Phase 3：日志与 CLI

- 已提供受 2 MB 上限保护的 Pod 日志快照和 follow operation；本机走 Kubernetes API 流读取，远端走共享 SSH
  transport 上受控的 `kubectl logs --follow`。取消仅关闭日志通道，不影响共享 SSH transport；工作区支持多容器、
  tail、since、时间戳、上一实例、搜索和保存日志。
- 已提供本地 / 远端来源一致的 CLI 启动：命令在 Rust 侧完成路径、context 与 namespace 引用，前端只创建既有
  本地或 SSH 终端并写入该命令；不会调用 `kubectl config use-context` 改写用户文件。
- CLI 会预检本机或远端 kubectl，并将来源与 context 标入终端标签。日志 follow 在本机 API / 远端 kubectl
  channel 上使用独立取消与重建边界；真实多 context 集群和网络 / 认证变化仍需验收。

### Phase 4：安全写操作

- 已完成：独立 `dssh-k8s://` Monaco YAML model、编辑器设置继承、创建模板、多文档预解析、服务端 dry-run、
  差异预览、Server-Side Apply、冲突二次确认、删除传播策略 / resourceVersion 前置条件、逐项结果，以及
  Deployment / StatefulSet / DaemonSet 扩缩容和滚动重启。
- 已完成：写操作统一通过后端执行并记录脱敏审计摘要；审计不会保存 kubeconfig、Token、Secret value 或完整 YAML。

### Phase 5：交互式运维

- 已完成：Pod Exec（容器 / shell / TTY）、Pod / Service 端口转发任务（端口占用预检、取消、状态事件）、
  Metrics API 安全降级、owner references / selector 关系展示、Watch / 日志 follow / kubectl channel 的独立
  取消边界，以及统一标签条、命令面板和独立 Kubernetes 原生窗口。
- 待验收：真实集群和低权限账号上的安全、取消、断线与跨平台矩阵；这些验收项保留在 `tasks.md` 的 KV 条目。

### Phase 6：可选增强

- Helm、CRD Schema 表单、RBAC 分析、资源关系图、多集群对比、Pod 文件传输和 AI 辅助。

## 8. 错误与恢复语义

- 错误按来源、阶段和 context 分类：配置读取、SSH、kubectl 缺失、认证、TLS、网络、RBAC、admission、
  资源冲突和超时不能合并成“连接失败”。
- 本地引用文件变化时使相关 client generation 失效并重建；正在编辑的 dirty YAML 不得丢失。
- 远端 SSH 中断时工作区进入“来源断开”，停止新的修改请求；transport 恢复后先重测 context 再恢复 list/watch。
- Watch 失效应自动重新 list，不影响当前选择；远端 kubectl 不支持可靠 Watch 时显式降级为可配置轮询。
- context 被删除、SSH profile 失效或 kubectl 版本不兼容时保留 profile，并提供重新绑定入口。
- 端口转发、日志跟随、Watch 和远端 CLI 都使用独立 operation / channel；取消某一项不会关闭共享 SSH
  transport 或其他工作区。端口本地监听存在启动前检查，但仍需真实平台验收以覆盖竞争占用。
- 安全导入的 kubeconfig 不会写入本地或远端 CLI 的进程环境，因此该来源明确禁用 CLI、Exec 和端口转发；
  需要这些能力时请使用路径引用 / 远端路径来源。这样可避免把导入的 Token 或私钥落入命令环境。

## 9. 验收矩阵

- 平台：macOS、Windows；远端执行端至少覆盖一种常见 Linux 发行版。
- 集群：至少覆盖本地开发集群、一个标准远端集群和一个使用 exec credential plugin 的云集群。
- 来源：本地自动发现、手工路径、文件选择 / 导入、远端默认环境、远端路径。
- context：单 context、多 context、同名 context、context 增删、不同默认 namespace。
- 权限：只读账号、namespace 管理账号、无权限账号；验证按钮状态与服务端拒绝一致。
- 故障：API 不可达、SSH 断开、kubectl 缺失、插件缺失 / 超时、Watch 过期、apply 冲突和删除部分失败。
- 安全：前端载荷、日志、SQLite、错误和 AI 上下文中均不得出现 Token、私钥或 Secret value。
- 常规验证：`pnpm exec tsc --noEmit`、`pnpm build`、`cargo fmt`、
  `cargo clippy --all-targets -- -D warnings`、`cargo test`。当前代码已通过这些工程级检查；真实集群、平台、
  权限、网络抖动和凭据插件验收仍不能由本地构建替代。

## 10. 参考

- [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [使用 kubeconfig 组织集群访问](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
- [Kubernetes Authentication / exec credential plugin](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)
- [Kubernetes Authorization](https://kubernetes.io/docs/reference/access-authn-authz/authorization/)
- [kube Rust client](https://docs.rs/kube/latest/kube/)
