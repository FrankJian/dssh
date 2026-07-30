# Duo SSH 里程碑记录（已完成）

> **历史存档**：本文件记录工作区界面与核心能力建设过程中各阶段的落地项与当时的取舍，供回溯「某个决定为什么是这样」时查阅。
>
> 当前的设计约定见 [`spec.md`](spec.md)，架构约定见 [`AGENTS.md`](AGENTS.md)，
> **后续待办请以 [`TODO.md`](TODO.md) 为准**；本文件只补录已经完成并通过本地验证的里程碑，不承载未来计划。
>
> 勾选规范：`[x]` 已完成 · `[ ]` 当时未做（多数已转入 TODO.md）。

## 图例与全局约定

- **保留不动**：S3 对象浏览器、Copilot OAuth、YAML/加密导入导出、`genai` ReAct Agent（含 `read_terminal`）。迁移时只换外壳与样式，不改其行为。
- **每次改动后验证**：前端 `pnpm exec tsc --noEmit`；后端 `cd src-tauri && cargo fmt && cargo check`。涉及存储/加密/解析/安全的加 `cargo test`。
- **Tauri 载荷 camelCase**：改命令/事件时同步 Rust serde DTO 与 TS 类型/服务。
- **安全红线**：密码/密钥/口令/S3 SecretKey/API Key/更新签名私钥永不下发前端、不入日志。

---

## Phase 0 — 设计系统（Violet）+ 布局骨架 🖥️

**目标**：全新 Violet 配色 + 新外壳（活动栏 / 左侧栏 / 顶部标签条 / 右侧面板 / 底部命令栏骨架）跑起来，把现有功能塞进新槽位保持可用。

- [x] **0.1 Violet 设计 token**：重写 `src/theme/global.css` 的 `:root`（深色默认）与 `:root[data-theme="light"]`，落 [spec §6](spec.md#6-视觉设计系统violet) 全部 token；补 `--selection`（=`--bg-selected`）、`--font-mono`、间距刻度 `--space-1..6`。
- [x] **0.2 终端 Nebula 主题**：改 `src/terminal/terminalTheme.ts` 为 spec §6.3 调色板（cursor `#8B7CF6`）。
- [x] **0.3 图标补充**：`src/ui/Icon.tsx` 增加所需 outlined 图标（sessions、connections、gauge、wrench、bell、panelLeft/Right、zap、search、command、splitH/V、wifiOff、power、arrowDownRight、code）。
- [x] **0.4 布局壳重构**：改 `src/app/AppLayout.tsx` 为 [spec §5.1](spec.md#51-新布局dssh-目标形态) 结构——`ActivityBar | LeftSidebar | MainColumn(TabStrip+Content+CommandBar) | RightPanel`；标题栏仅留品牌名 + 拖拽区 + 窗口控件；左侧栏与右面板均可拖拽调宽。
- [x] **0.5 活动栏改造**：`src/app/ActivityBar.tsx` 顶部 `侧栏折叠 / Sessions / Files / S3 / Assistant / HostTools`，底部 `新建本地终端 / Notifications / Settings`；`ActivityId` 重构为 `sessions|files|s3` + `RightPanelId`。（`Connections`→会话管理器标签延到 P2。）
- [x] **0.6 骨架占位**：`CommandBar`（可发送命令到当前终端）、`HostToolsPanel`（工具二级标签 + 空态）静态骨架；`TabStrip` 迁移到内容区顶部，保证壳可渲染。
- [x] **0.7 现有功能塞槽位**：把 `TerminalWorkspace`/`S3Workspace`/`FileBrowser`/`AiChat` 接进新壳（AI 移入右面板；标签沿用旧会话逻辑），确保不回归。
- [x] **0.8 清理**：移除死 CSS（hover-dock/pin、`.workspace*`）；修 `index.html` 标题/favicon/lang 为 dssh。（后端 `theme/mod.rs` 死代码为 6 行未接线 stub，延到后端阶段清理以免打断正在运行的 dev。）

**验收**：`pnpm tauri dev` 启动，界面呈现 Violet 配色 + 新四区布局；SSH/本地终端、S3、SFTP、AI 均可打开且功能不回归；`tsc --noEmit` 与 `cargo check` 通过。
**🖥️ dev 检查点 #1**：让用户看到新配色 + 新壳。

---

## Phase 1 — 会话树 + 顶部标签系统 🖥️

**目标**：左侧「活动会话」树（节点→子项）+ 顶部标签驱动的内容区。

- [x] **1.1 工作区状态**：新增 [`src/app/useWorkspace.ts`](src/app/useWorkspace.ts)——协调 SFTP 标签 + 活动 surface（终端会话仍归 `useTerminalSessions`）。
- [x] **1.2 TabStrip（顶部）**：新增 [`src/app/WorkspaceTabStrip.tsx`](src/app/WorkspaceTabStrip.tsx)——终端 + SFTP 统一标签；图标 + 标题 + 关闭；活动标签 2px 主色顶边；中键关闭。（拖拽重排延到后续。）
- [x] **1.3 TabKind 分发**：内容区按 surface 渲染 `terminal`（TerminalWorkspace）/`sftp`（FileBrowser 全页）；`s3` 仍走独立 activity（统一进主标签条延到后续）；`Forwards/HostMonitor/SessionManager/Settings` 分别为对话框/右面板/后续阶段。
- [x] **1.4 会话树组件**：新增 [`src/ssh/SessionTree.tsx`](src/ssh/SessionTree.tsx)——节点行（状态点 + 标题 + user@host）+ 展开子项：新建终端 / SFTP / 端口转发 / 终端 1..N / 断开。下方仅保留「收藏」快捷启动 + 「全部连接 →」入口（**完整的连接库只在「连接管理」里，二者不重复** —— 依用户反馈从「完整保存列表」收敛为「收藏快捷」）。（钻入/另存为延到 P5 后端多跳；本地终端聚合为「本地终端」节点。）
- [x] **1.5 树↔标签联动**：点终端项聚焦对应标签；SFTP/新建终端在顶部生成标签；一个节点含多个终端。
- [x] **1.6 后端节点雏形**：前端投影——`SessionTree` 把当前会话按 host（profileId）/本地聚合为节点视图。（`list_nodes` + 共享连接注册表落地在 P5。）
- [x] **1.7 断开/连接动作**：树「断开」关闭该节点全部会话并清理其 SFTP 标签；错误态终端项仍可关闭；连接走「已保存的连接」列表。（移除了独立 files activity，SFTP 改为节点内标签。）

**验收**：连接一台主机后，左侧出现该主机节点并可展开；从树里新建终端 / 打开 SFTP / 打开转发都在顶部生成对应标签并正确显示；关闭标签、拖拽重排正常。
**🖥️ dev 检查点 #2**：会话树 + 顶部标签联动。

---

## Phase 2 — 会话管理器（连接中枢）🖥️

**目标**：一个 `SessionManager` 标签作为连接管理中枢，替代/增强旧 `ProfileSidebar`。

- [x] **2.1 SessionManager 视图**：新增 [`src/ssh/SessionManager.tsx`](src/ssh/SessionManager.tsx)——工具栏（搜索 / 新建连接 / 排序 最近·名称·主机 / 视图 Grid·List·Tree / 导入 / 导出）+ 内容 + 底部状态条（连接数 · 活动会话数）。作为 Connections 活动的整页 surface（对齐 S3 的处理方式）。
- [x] **2.2 连接卡片**：新增 [`src/ssh/ConnectionCard.tsx`](src/ssh/ConnectionCard.tsx)——图标 + 名称 + `user@host:port` + 标签 + 行内操作（连接 ▶ / 编辑 / 删除 / 收藏）；`data-variant` 支持 Grid（卡片）与 List（横排）两种密度；双击连接。
- [x] **2.3 分组与最近**：Tree 视图按 收藏/标签/未分组 分组（复用 [`profileGroups`](src/ssh/profileGroups.ts)）；「最近使用」区由 [`useRecentConnections`](src/ssh/useRecentConnections.ts)（localStorage）驱动，连接时记录。**决策：用 localStorage 记录最近，避免本轮后端迁移**（见 2.7）。
- [x] **2.4 导入导出接线**：工具栏 导入/导出 按钮打开「设置 → 配置文件」页，复用既有 YAML 明文 + 加密（Argon2id+AES-256-GCM）导入导出流程（含密码对话框），零重复实现。
- [x] **2.5 复用编辑器**：新建/编辑连接复用 `ProfileEditor`（经 App 的 `openCreateProfile`/`openEditProfile`，含密码/密钥、代理、标签）。
- [x] **2.6 Sessions 活动 = 树；Connections 活动 = 会话管理器**：活动栏新增 Connections（LayoutList）；活动高亮不再受侧栏折叠影响。
- [x] **2.7 后端小改**：**改为 localStorage 记录最近（见 2.3），未做 `last_used_at` 迁移**；如后续需要跨机持久化再补 `006_last_used.sql`。

**验收**：Connections 活动打开会话管理器；可搜索/排序/切视图/分组/看最近；从卡片一键连接后左侧树出现节点、顶部出现终端标签；导入导出可用。
**🖥️ dev 检查点 #3**：连接管理中枢。

---

## Phase 3 — 右侧面板：AI 助手 + 主机工具 🖥️

**目标**：右侧可停靠面板，`Assistant`（AI）｜`HostTools`（监控/进程/服务/日志/端口）二选一，作用于当前节点。

- [x] **3.1 RightPanel 容器**：右侧停靠面板在 P0 已建（`AppLayout` 的 `.right-dock`，可拖拽 280–640 持久化）；活动栏 Assistant/HostTools 图标切换、再点关闭。
- [x] **3.2 AI 迁移**：`AiChat`（`layout="panel"`）已在 P0 接入右面板；当前会话作为 AI 上下文（`currentServer`）。
- [x] **3.3 主机工具后端**：新增 [`src-tauri/src/hosttools/mod.rs`](src-tauri/src/hosttools/mod.rs) + [`commands/hosttools.rs`](src-tauri/src/commands/hosttools.rs)——`host_tools_snapshot(profileId, tool)`，复用 `run_ssh_command`（AI 同款路径）跑只读白名单命令 + 容错解析：监控（hostname/uptime/loadavg/nproc/free）、进程（`ps --sort=-pcpu`）、服务（`systemctl list-units`）、日志（`journalctl`/`tail syslog`）、端口（`ss`/`netstat`）；12s 超时；解析失败降级 `raw` 原始文本。`cargo check` 零错误零告警。
- [x] **3.4 HostToolsPanel**：[`src/hosttools/HostToolsPanel.tsx`](src/hosttools/HostToolsPanel.tsx)——二级标签（监控/进程/服务/日志/端口）+ 指标卡/表格/日志渲染 + 手动刷新 + 加载/错误/空态；解析为空时回退显示原始输出。
- [x] **3.5 选中连接同步**：右面板跟随当前活动 SSH 会话的 profile；切换终端标签即刷新（本地/无连接 → 空态）。
- [x] **3.6 TS 类型/服务**：新增 [`models/hosttools.ts`](src/models/hosttools.ts) + [`services/hostToolsService.ts`](src/services/hostToolsService.ts)。

> 历史说明：初版每次取数会新开 SSH 连接；共享连接池完成后，主机工具与 AI exec 已改为在共享 transport 上打开独立 channel。

**验收**：右侧可切 AI / 主机工具；选中已连接主机后，监控/进程/服务/日志/端口能拉到真实数据并结构化展示；AI 在右面板可正常对话且带当前主机上下文。
**🖥️ dev 检查点 #4**：右侧 AI + 主机工具。

---

## Phase 4 — 底部命令栏 + Shell 集成 + 快捷命令 + 命令面板（历史）

**目标**：终端标签底部命令栏（目标/CWD/git chip + 命令输入 + 快捷命令）+ ⌘K 命令面板。

- [x] **4.1 CommandBar**：历史版本曾提供目标 chip、CWD / git chip 与命令输入行。
- [x] **4.2 Shell 集成（后端透传 + 可选注入）**：历史版本曾通过前端注入 OSC 7 / OSC 1770 脚本。
- [x] **4.3 Shell 集成（前端解析）**：`parseSessionMeta` 从输出流解析 OSC 7 → CWD、OSC 1770 → git，写入 `useTerminalSessions` 的 `sessionMeta`，驱动命令栏 chip。（OSC 133 命令边界标记延后。）
- [x] **4.4 快捷命令**：历史版本曾用 localStorage 保存快捷命令并检测高风险命令，未创建数据库迁移。
- [x] **4.5 快捷命令 UI**：命令栏 `Zap` 弹层——搜索/填入输入/立即执行（危险命令二次确认）/删除/「保存当前输入为快捷命令」。
- [x] **4.6 命令面板（⌘K）**：新增 [`src/app/CommandPalette.tsx`](src/app/CommandPalette.tsx)——⌘K/Ctrl+K 打开；模糊搜索连接 / 打开的终端·SFTP 标签 / 动作（新建终端、连接管理、S3、切换 AI·主机工具面板、设置、切换主题）；键盘上下/回车/Esc。

> 当前状态：底部 CommandBar、Shell Integration 和快捷命令 UI 已在后续界面收敛中移除；⌘K / Ctrl+K 命令面板仍保留。当前行为以 [`spec.md`](spec.md) 与代码为准。

**验收**：终端底部出现命令栏，CWD 随 `cd` 更新（开启 shell 集成时），命令输入可发送；快捷命令可增删查、可执行（危险确认）；⌘K 可跳转连接/标签/动作。
**🖥️ dev 检查点 #5**：命令栏 + ⌘K。

---

## Phase 5 — 优雅重连 + SSH 共享连接池

**目标**：断线 30s 宽限自动恢复；同一有效连接配置复用一条物理 SSH transport。

- [x] **5.5 优雅重连（SSH 终端）** ✅ 本轮核心：`ssh/session_manager.rs` 把 SSH 运行拆为 `connect_and_run`（读端独立 task 保留解码循环 + 写端 `select!`）+ 外层重连循环。新增 `SessionStatus::Reconnecting`；断线（非正常退出）后 30s 宽限内指数退避重连（1s→15s），keepalive 收紧到 15s×3（~45s 探测断线）；区分**正常 `exit`（不重连）** vs **传输断开（重连）**。
- [x] **5.6 相位/取消**：`emit_status` 复用推送重连状态（前端黄色提示 + 会话栏「重连中·取消」chip + 树节点/状态点变黄）；新增 `cancel_reconnect` 命令 + 服务 + `useTerminalSessions.cancelReconnect`。`cargo check` 零错误零告警。
- [x] **5.1–5.4 共享连接多路复用池**：新增 `ssh/connection_pool.rs`，以 profile 版本、认证类型和代理路由组成非敏感连接键；终端 PTY、SFTP subsystem、主机工具 / AI exec 与全部端口转发类型在共享 transport 上申请独立 channel lease。连接池实现 channel 上限、诊断计数、空闲回收和单飞重连。
- [x] **5.7 自动化回归**：连接键、transport / channel 生命周期、channel 上限、重连退避与远程转发路由均已有 Rust 单元测试；当前测试集 26 项通过。macOS / Windows 与真实低 `MaxSessions` 主机的组合验收仍保留在 TODO。

**本轮验收**：主动断网 <30s 再恢复，终端自动重连为新 shell（滚屏保留），无需手动点重连；重连中可取消；`exit` 正常退出不触发重连；`cargo check` 通过。
**🖥️ dev 检查点**：断网重连演示。

---

## Phase 6 — 安全加固：主机密钥 TOFU（钥匙串迁移延后）

**目标**：修复「无条件接受主机密钥」；首次信任、变更告警。

- [x] **6.5 主机密钥 TOFU** ✅：新增 [`ssh/host_keys.rs`](src-tauri/src/ssh/host_keys.rs) `HostKeyVerifier`（`AppState.host_keys`）——`known_hosts.json` 持久化指纹；未知→事件 `ssh://hostkey-prompt` → [`HostKeyPrompt`](src/ssh/HostKeyPrompt.tsx) 模态（显示 SHA256 指纹）→ `respond_host_key_prompt`；匹配→静默；变更→拒绝 + `ssh://hostkey-changed` 告警。按 `host:port` 合并并发提示。
- [x] **6.6 覆盖所有路径** ✅：`SshClient`（终端 + `command.rs` 的 AI/主机工具）与 `ForwardHandler`（转发）均改为持有 `Arc<HostKeyVerifier>` 并校验——`SshClient` 变成有状态后，编译器强制所有连接点（session/command/sftp/forwarding）都传入 verifier，无遗漏。`cargo check` 零错误零告警。
- [ ] **6.1–6.4 系统钥匙串迁移**（`keyring`/`zeroize` + `SecretStore` + `migrate_secrets_to_keychain` + 导入导出兼容）：**延后**。这是对**凭据存储/认证路径**的深度改造，迁移出错会导致连不上 / 丢凭据，且难以在此环境安全验证。当前凭据仍明文存 SQLite（见 README「数据与安全」）。
- [ ] **6.7 测试**：随钥匙串落地时补 `cargo test`。

**本轮验收**：首次连接弹指纹确认，信任后记住、再连不问；指纹变更被拒并告警；`cargo check` 通过。

---

## Phase 7 — 收尾：分屏 + Toast + 禅模式 + 文档（终端背景/通知中心延后）

**目标**：补齐禅模式与文档收尾；其余 P7 项延后。

- [x] **7.1 分屏 PaneGrid** ✅：新增 [`usePaneLayout`](src/terminal/usePaneLayout.ts)（每个终端标签独立的嵌套 pane 树，最多 4 个叶子）+ [`PaneGrid`](src/terminal/PaneGrid.tsx)（每 pane 独立终端、基于当前焦点横向 / 纵向拆分、拖拽分隔条、聚焦 / 关闭）；标签条提供分屏按钮；`useTerminalSessions` 提供按 session 的 I/O。
- [x] **7.2 Toast** ✅：新增 [`ui/ToastHost.tsx`](src/ui/ToastHost.tsx)（模块级发射器 + 宿主）；连接/拆分错误改用 Toast。**通知中心（🔔 未读角标 + 历史）+ 全量替换 window.alert/confirm 延后**。
- [x] **7.3 禅模式** ✅：`AppLayout` 活动栏可空；App 加 `zenMode`（持久化）隐藏 活动栏/侧栏/标签/右面板/命令栏，只留终端；命令面板动作 + `Esc` 退出 + 右下角悬浮「退出禅模式」按钮。
- [x] **7.6 文档更新** ✅：更新 [`AGENTS.md`](AGENTS.md)、[`README.md`](README.md)、[`spec.md`](spec.md) 与 [`TODO.md`](TODO.md)，分别记录架构约束、用户功能、设计机制和后续路线。
- [ ] **7.4 终端背景(lite)**：**延后**（见 TODO.md）。
- [ ] **7.5 设置整合 / 7.7 全量回归**：本轮已随各阶段验证（`tsc --noEmit` + `cargo check` 每阶段通过）。

**本轮验收**：分屏（≤4，可拖拽/关闭）；连接错误走 Toast；禅模式可切（Esc 退出）；文档齐全；`tsc` + `cargo check` 通过。

---

## Phase 8 — 远程 Explorer、Monaco 与标签独立窗口

- [x] **8.1 远程 Explorer**：目录树支持路径根节点、懒加载、多选、上传 / 下载、本机拖入上传、新建、重命名、同主机移动、递归删除、权限属性与操作进度；文件编辑、图片和 Markdown 预览保持在独立职责中。完整边界见 [`features/remote-explorer-enhancement.md`](features/remote-explorer-enhancement.md)。
- [x] **8.2 Monaco 编辑器**：普通文本使用按需加载的 Monaco model，支持语言识别 / 手动选择、行号、折叠、查找替换、多光标和保存保护；图片与 Markdown 继续走现有预览。完整边界见 [`features/monaco-editor-integration.md`](features/monaco-editor-integration.md)。
- [x] **8.3 标签独立窗口**：终端或 SFTP 标签可拆为原生 Tauri 子窗口。终端保留原 session ID 与 scrollback；分屏时迁移完整 pane 树。关闭原生子窗口或点击“合并回主窗口”恢复并聚焦原标签，关闭子窗口标签则关闭对应 session。
- [x] **8.4 跨窗口权限与路由**：新增进程级 `DetachedWorkspaceManager`、camelCase DTO / service、`workspace://detached-window-*` 事件，以及仅匹配 `detached-*` 的 Tauri capability；修复子窗口无 IPC 权限、初始化空 session 回写和单终端合并后焦点丢失问题。

**本地验证**：前端 `pnpm exec tsc --noEmit` / `pnpm build`、Rust `cargo fmt` / Clippy / `cargo test` 通过；仍需在 macOS 与 Windows 打包产物人工验收 Explorer、Monaco、共享连接池与独立窗口组合行为。

---

## 附录 A — 依赖变更清单

- 后端共享连接池与独立窗口登记基于现有 Tauri / russh 和标准同步容器实现，未引入 `dashmap`、`keyring` 或 `zeroize`；钥匙串相关依赖仍属于 TODO。
- 前端新增 `monaco-editor`；xterm.js、react-markdown 及其余现有依赖沿用。命令面板、分屏与独立窗口壳使用现有 React / Tauri API。

## 附录 B — 数据迁移与运行时文件

- 当前数据库迁移截至 `005_ssh_proxies.sql`。
- 最近使用、快捷命令、标签顺序和 pane / 窗口展示状态没有新增迁移，分别保存在 localStorage 或进程内存。
- `006_last_used.sql` 与钥匙串引用迁移只有在对应 TODO 实施时才创建；不要预先创建空迁移。
- 运行时持久文件为 `known_hosts.json`；共享连接池和独立窗口登记不写入磁盘。

## 附录 C — 保留能力回归清单（每阶段结束自查）

- [ ] S3 对象浏览器：桶/前缀/对象、上传下载、ACL、清理、书签 全部可用。
- [ ] Copilot OAuth 登录与 AI 对话可用。
- [ ] YAML 明文 + 加密导入导出可用（脱敏正确）。
- [ ] SSH/本地终端、SFTP、端口转发 功能不回归。
- [ ] 自动更新（关于页）可用。
