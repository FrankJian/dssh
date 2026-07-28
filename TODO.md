# dssh TODO / 后续路线

> 本文件汇总**尚未实现或有意延后**的内容，以及维护时需要注意的事项。
> 架构约定见 [`AGENTS.md`](AGENTS.md)，功能与发布流程见 [`README.md`](README.md)。
> 优先级：**P1 = 建议优先**，**P2 = 有价值**，**P3 = 长期/可选**。

---

## 一、延后的后端重点（都建议单独一轮 + 真实主机验证）

### 1. 共享连接多路复用池 · P1
- **现状**：每个功能各自建立 SSH 连接——终端、SFTP、端口转发各开一条；主机工具 / AI 每次取数用 `run_ssh_command` 新开一条单发连接。
- **目标**：一台主机一条物理 russh 连接，终端 PTY / SFTP / 转发 / 主机工具在其上多路复用 channel（`DashMap<ConnectionId, SharedConnection>` + 节点路由）。
- **注意**：这是对**核心连接代码**的深度重写，风险最高。russh 的 `Handle` 支持在一条连接上并发开多个 channel（`channel_open_session` 取 `&self`），架构可行；但务必用真实 SSH 主机做回归（终端一旦坏 = 整个应用坏）。落地后补 `cargo test`（并发、节点路由、快照/恢复）。
- **相关**：会话树多跳「钻入（下一跳 / 跳板）」与「另存为连接」依赖节点路由，一并在此实现。

### 2. 系统钥匙串（OS keychain）迁移 · P1
- **现状**：SSH 密码 / 私钥 / 口令 / S3 SecretKey / API Key 以**明文存于 SQLite**（`app_secrets` 及 `ssh_profiles` 相关列）。`authenticate` 直接把 `secret_ref` 当明文密码用。
- **目标**：引入 `keyring` + `zeroize`；密钥存 OS keychain（macOS Keychain / Windows Credential Manager），DB 只存引用键；提供 `migrate_secrets_to_keychain`（迁移前自动加密备份、幂等、迁移后清空明文列）。
- **注意**：迁移出错会导致**连不上 / 丢凭据**，必须：先备份（复用现有加密导出）、逐类型迁移、保留回退路径、充分测试读写与幂等。加密导出仍可含真实凭据（从钥匙串取），YAML 明文导出继续脱敏 `******`。

### 3. `last_used_at` 落库 · P3
- 现在「最近使用」用 localStorage（[`useRecentConnections`](src/ssh/useRecentConnections.ts)）。若要跨机同步，补 `006_last_used.sql` + `start_ssh_session` 时更新。

---

## 二、延后的前端功能

### 4. 通知中心 · P2
- 已有轻量 Toast（[`ui/ToastHost.tsx`](src/ui/ToastHost.tsx)）。待补：通知历史面板；把仍在用的 `window.alert/confirm`（S3/SSH 删除确认、主机密钥变更告警等）统一为一致的通知/确认组件。销毁性确认仍需阻塞式。

### 5. 分屏增强 · P2
- 现为**扁平**单方向分屏（[`usePaneLayout`](src/terminal/usePaneLayout.ts)，最多 4 个，一行或一列），新面板继承所在主机。
- 待补：**嵌套分屏**（任意 H/V 树）、分屏布局随标签持久化、把某个已有会话拖入分屏。

### 6. 标签拆出独立窗口 · P3
- ✅ 已完成：拖拽重排（顺序存于 `useWorkspace.tabOrder`）。
- 待补：**拆出独立窗口**——需要 Tauri 多窗口 + 会话输出路由到新窗口，工作量较大；另可把标签顺序持久化到 localStorage。

### 7. 终端外观增强 · P3
- ✅ 已完成：背景图片（后端 `read_image_data_url` 读成 data URL，避开 asset 协议作用域）+ **背景不透明度**滑块（20–100%），调低即透出图片或应用背景。
- 待补：**整窗对桌面透明**（需开启 Tauri 窗口透明 + macOS vibrancy）、按标签或按主机分别设置壁纸。

### 8. S3 并入主标签条 · P3
- 现在 S3 是独立 activity + 自带子标签。可考虑并入统一顶部标签条（`WorkspaceTabStrip` 增加 `s3` tab kind），与终端 / SFTP 一致。

### 9. i18n · P3
- 目前仅中文（UI 文案硬编码）。如需多语言，抽取文案 + 语言切换。

### 10. 远程 Explorer 增强 · P2
- **已完成**：懒加载目录树、文件上传下载、目录打包下载、新建文件 / 文件夹、重命名、删除文件和删除空目录，以及右键菜单与确认流程。
- **待补**：递归删除（必须预览影响范围、二次确认和可取消进度）、多选 / 批量操作、拖拽上传与远端拖拽移动、传输进度聚合、文件权限 / 属性查看。
- **注意**：删除目录当前只允许空目录；所有文件操作必须继续经 SFTP / TOFU 路径，禁止借终端拼接 `rm`、`mv`、`mkdir` 命令。

### 11. Monaco 远程代码编辑器 · P2
- **现状**：文件列表旁已有轻量文本编辑、图片预览和 Markdown 预览；SFTP 树负责远端路径、上传和下载。
- **目标**：仅将文本编辑区域升级为 Monaco，提供代码高亮、行号、折叠、查找替换和多光标；继续由既有 SFTP 命令保存远端文件。
- **边界**：Monaco 不替代目录树、上传下载或后续的创建 / 删除 / 重命名；它也不等同于 VS Code Workbench 或远端 LSP。完整规格见 [`features/monaco-editor-integration.md`](features/monaco-editor-integration.md)。
- **注意**：采用 Vite ESM worker + 懒加载，必须在 macOS / Windows 打包 WebView 中验证 worker。model 使用稳定的 `dssh-sftp://` URI，关闭标签及断开会话必须 dispose。

---

## 三、已知限制

### 12. 选中文字的字重差异（GPU 渲染）
- **现象**：开启 GPU 渲染时，选中的文字字重看起来与未选中略有不同。
- **根因**：xterm 的 WebGL 渲染器把单元格背景色**烘焙进字形纹理**——未选中的字形在透明背景上光栅化、由着色器合成，选中单元格则生成新的图集条目并按选中色抗锯齿，两条路径的抗锯齿结果不同。DOM 渲染器不使用图集，文字节点不变，因此无此问题。xterm 未提供关闭该行为的开关。
- **已缓解**：选中色改为与终端底色亮度接近（`#2b2550` / 非活动 `#201c38`），两次光栅化结果更接近，差异大幅降低。
- **彻底规避**：设置 → 终端 → 渲染，关闭「启用 GPU 渲染加速」（改用 DOM 渲染，像素级一致；代价是大量输出时略慢）。设置页已注明该权衡。
- 可选后续：给选中态单独提供「强制 DOM 渲染」策略，或跟进 xterm 上游是否提供图集背景分离选项。

---

## 四、维护注意事项（Caveats）

- **凭据仍明文**：keychain 未落地前，不要存敏感生产凭据；导出的 YAML / 加密文件妥善保管。
- **主机工具 / AI 每次新开连接**：共享连接池落地前，频繁刷新主机工具会反复建连，属预期。
- **重连拿到的是新 shell**：普通 SSH 连接断开后远端 shell 即销毁，重连是**新 shell**（滚屏在前端保留）；要保持会话请在远端用 tmux / mosh。
- **前端本地态**：最近连接、标签顺序、面板宽度、禅模式、主题、活动 / 右面板选择、终端背景与更新代理都存 `localStorage`（每机独立，不入 DB、不随配置导出）。
- **主机密钥**：信任的指纹存 `known_hosts.json`（应用数据目录）。指纹变更会被拒绝；若为预期变更（如服务器重装），手动删除该文件中对应条目后重连。
- **`SshClient` 有状态**：任何新的 SSH 连接点都必须构造带 `HostKeyVerifier` 的 `SshClient` / `ForwardHandler`——不要再写「无条件接受主机密钥」的 handler。
- **分屏按钮不能放进单个面板**：分屏后 `PaneGrid` 会替换 `TerminalWorkspace`，面板内的控件会随之消失。终端级动作放在顶部标签条或命令面板。
- **更新源只有 GitHub**：`tauri.conf.json` 的 `plugins.updater.endpoints` 与 `commands/app.rs` 的 `UPDATE_ENDPOINTS` 需保持一致（后者用于逐条诊断）。网络受限时用「设置 → 关于 → 更新代理」。

## 五、验证清单（改动后必跑）

- 前端：`pnpm exec tsc --noEmit`（+ `pnpm build` 做产物校验）。
- 后端：`cd src-tauri && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`。
  **CI 把 clippy 警告当错误**，本地先跑一遍免得红灯。
- 可视化：`pnpm tauri dev` 人工走查；改 Rust 会自动重编译重启。
- 改命令 / 事件时同步 Rust serde DTO 与 TS 类型 / 服务（Tauri 载荷 camelCase）。
