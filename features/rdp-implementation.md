# RDP 首版实施说明

## 当前交付

当前实现设计中的独立窗口直连 MVP，优先面向 Windows Server 内网连接：

- 连接管理器聚合 SSH / RDP，支持搜索、类型筛选、标签、收藏、新建 / 编辑 / 删除；保留原有 SSH DTO。
- `010_rdp_profiles.sql` 保存独立配置，系统密码存入 macOS Keychain / Windows Credential Manager，公开 DTO 只返回 hasPassword。保留 / 替换 / 清除密码有明确操作；不保存时每次连接输入。
- RdpManager 负责每个工作台的会话，私有管道启动独立 FreeRDP SDL3 客户端；密码不写命令行、环境、文件、日志或状态事件。
- 后端等到原生协议握手后才传送启动参数。原生 PostConnect 回调后才标记已连接，进程启动不等于连接成功。
- 工作台可聚焦 / 关闭桌面；同 profile 在同一工作台重复连接会聚焦已有客户端。结束后可手动重连，不自动尝试错误密码。
- 关闭所属工作台或应用会清理 worker；应用锁强制结束客户端；父进程异常退出时管道 EOF 使 worker 退出。Windows 服务端是否保留远端登录会话遵循服务端策略。
- 命令面板可创建 RDP 配置、连接已保存桌面和聚焦活动窗口。活动会话侧栏显示独立 RDP 分组。

## 证书行为

证书策略按连接单独保存，默认保持严格验证，不自动降级：

1. 留空指纹：导出运行机器的公开信任根供打包 OpenSSL 使用，要求证书链和目标主机名验证成功；拒绝通过 FreeRDP 旧 known_hosts / 用户策略绕过失败。
2. 填写完整 SHA-256：用户先从可信渠道核对服务器实际使用的证书，再保存指纹。匹配固定证书才继续；即使替换证书通过 CA 校验，指纹不符也拒绝。
3. 显式开启“跳过服务器证书验证（不安全）”：使用 FreeRDP `/cert:ignore`，跳过证书链、主机名和指纹校验。界面说明服务器身份无法验证及中间人攻击风险，连接卡片、活动会话和原生窗口标题持续显示未验证状态；TLS 和 NLA 保持启用。已保存的指纹保留，关闭该选项后恢复原有严格校验。旧配置缺省为 false，无需改变现有数据库表。

FreeRDP 原生实现经过小范围、有锚点检查的适配：私有管道协议、状态消息、禁止交互式密码重试、固定证书严格匹配。修改由 `scripts/build-rdp.mjs` 对固定发行源应用；校验源归档 SHA-256，不跟随 master。

### 安装包认证依赖修复

开发机可连接、安装包失败时，曾定位到 OpenSSL legacy-provider 的隐式依赖：默认构建的 MD4 / RC4 由外部 provider 提供，但发布 runtime 没有携带构建机模块。在旧构建配置中，公开测试向量自检在本机 provider 可用时通过，指定不存在的模块目录后报 `crypto-md4-unavailable`。

现在固定开启 FreeRDP/WinPR 的 `WITH_INTERNAL_MD4` / `WITH_INTERNAL_RC4`，并内嵌 SDL 字体资源。构建在替换 runtime 前强制运行不依赖 OpenSSL 安装目录的加密自检；CI 还会复制整个 runtime 到临时目录，清理环境后验证 MD4 / RC4 的公开测试向量。该修复保持 TLS / NLA 策略不变，不依赖用户另行安装 OpenSSL。

修复后已在本机生成真正的 release 模式 macOS app，并直接对包内 worker 执行全部 5 项原生回归，均通过；`otool` 检查没有指向 Homebrew / 构建机的绝对动态库依赖。此验证覆盖加密组件、TLS 协商、私有管道与生命周期，不替代真实 Windows 桌面登录验收。修改必须重建原生 worker 和安装包，不能只用前端 HMR 或沿用旧的 runtime 目录。

原生进程回传固定初始化阶段和数字错误码。Rust 在进程退出后等待并消费最后的状态消息，避免错误被退出竞态丢弃；用户提示附带阶段、退出码与 RDP 代码，区分加密组件、运行库、显示、网络和账号错误。密码、原始日志和服务器文本不进入诊断。

首版不含自动发现证书 / 首次信任弹窗。保存指纹是显式信任操作；证书更换需管理员重新核对后编辑。RDP 也不保证共享当前物理屏幕，不支持把 Windows Home 用作内置 RDP 服务端。

## 本地构建与运行

日常前端与 Rust 检查不要求安装 RDP 编译依赖。需要实际打开桌面时，先构建原生引擎。

macOS 构建依赖：CMake、Ninja、SDL3、OpenSSL 3/4、FreeType、json-c。Apple Silicon 默认使用 `/opt/homebrew`；Intel / 自定义前缀可设置 `DSSH_RDP_PREFIX`。脚本构建固定 SDL_ttf 3.2.2，FreeRDP 固定 3.33.0；引擎构建目录包含版本号。

```sh
pnpm rdp:build
pnpm tauri dev
```

Windows 在 MSVC Developer PowerShell 中配置 CMake / Ninja 和 VCPKG_ROOT，先安装：

```powershell
vcpkg install sdl3 sdl3-ttf openssl json-c --triplet x64-windows-static
pnpm rdp:build
pnpm tauri dev
```

产物写到被 gitignore 的 `src-tauri/rdp-runtime/`，包含 worker 和运行库；缓存写到 `.cache/rdp/`。脚本可使用 `DSSH_RDP_ARCHIVE` / `DSSH_RDP_TTF_ARCHIVE` 指定离线源包，但仍强制校验摘要。

Windows worker 与全部 vcpkg 依赖统一使用静态 CRT（Release `/MT`，Debug `/MTd`），CMake 显式设置 `CMAKE_MSVC_RUNTIME_LIBRARY`，独立构建目录为 `.cache/rdp/build-windows-static/`，不复用旧 `/MD` 依赖对应的 CMake 缓存。配置完成后检查 triplet、CRT 和静态链接选项，再进入编译；不通过 `/NODEFAULTLIB` 隐藏运行库冲突。CI 和许可证收集使用相同 triplet。

解压统一通过 stdin 传入归档字节；Windows 显式使用 `%SystemRoot%\System32\tar.exe`，避免 Git Bash 的 GNU tar 把 `D:\...` 识别成远程归档地址。`pnpm test:rdp-build` 覆盖 Windows 工具选择、私有 stdin 调用与带空格路径的真实压缩包解压；原生构建 CI 在安装依赖前执行该回归。

包含原生引擎的本地安装包：

```sh
pnpm rdp:package
```

CI 的安装包与 release 工作流已增加原生构建 action 和 `tauri.rdp.conf.json` 资源覆盖。直接运行不带覆盖的 `pnpm tauri build` 不会自动包含原生资源；界面会明确提示引擎缺失。

构建脚本重定位 macOS 动态库，附带 FreeRDP 和依赖许可证，使用本地 ad-hoc 签名。正式发行仍需检查最终依赖清单和许可证材料，并用发行身份对所有 native 组件签名和做干净系统验收；不依赖用户安装 Homebrew 或 XQuartz。

RDP 默认使用带系统标题栏的可缩放窗口，显式关闭初始全屏。初始客户区按显示器可用区域及标题栏 / 边框等比缩小、居中，避开本机任务栏和 Dock；配置中的远程桌面分辨率保持不变，拖动窗口边缘通过 smart sizing 缩放画面。原生构建运行独立窗口回归，检查边框、工作区适配、移动、缩放，以及 Windows 的标题栏 / 最小化 / 最大化 / 关闭样式；仍需新 Windows 安装包完成真实桌面与多 DPI 验收。

原生层在参数解析完成后再次约束初始单窗口模式，关闭 fullscreen / multimon / span，并启用 decorations / smart sizing。连接完成后的 fullscreen-exit 事件也重新退出 SDL 全屏、恢复边框和适配工作区，避免只在窗口创建时调整尺寸。回归覆盖实际 fullscreen → windowed 转换；macOS 测试使用桌面全屏，避免临时测试程序触发 Spaces 动画。用户主动切换全屏仍使用默认的右 Shift + Enter。更新这些逻辑需要安装包含新 `rdp-runtime` 的完整包，仅替换主程序不会更新原生窗口实现。

原生顶部控制栏在鼠标移入客户区顶部 4 个逻辑像素时显示，提供最小化、最大化 / 还原、全屏 / 退出全屏和关闭；鼠标停留栏内保持显示，离开约 650ms 后隐藏。使用 Windows 原生按钮 / macOS NSPanel 与 NSButton，按钮事件进入现有 SDL 主线程，不向远程桌面发送这些点击。显隐由主事件循环驱动，静止画面也可触发；失去前台、最小化或窗口销毁时隐藏并释放控件。窗口回归覆盖显隐时序、真实原生按钮发送的四种操作与资源清理；测试用预览程序不进入安装包。

Windows 全屏时使用 `ITaskbarList2::MarkFullscreenWindow` 标记当前窗口，令本机任务栏退到其后；切走、最小化或退出时撤销标记。该行为不修改全局任务栏设置，不隐藏远程 Windows 自身的任务栏。真实 Windows 任务栏、多 DPI 和跨屏行为仍需安装包验收。

本地关闭按钮、顶部控制栏和断开快捷键发送固定的 `user-close` 状态；后端进入最多两秒的清理流程。正常关闭 / 注销 / 主动取消的条目从会话栏隐藏；网络错误、服务端超时或替换、原生崩溃保留失败条目及原因。前端内部保留已关闭修订号，避免较旧的事件或快照使条目重新出现；保存的连接配置不删除。

系统标题栏关闭（`SDL_EVENT_WINDOW_CLOSE_REQUESTED`）和系统退出（`SDL_EVENT_QUIT`）在主事件循环中优先上报主动关闭，再中止连接，避免事件被对话框 / 显示处理消费或在销毁期间失败。对话框自身的关闭不结束桌面会话。

SDL3 的事件处理循环在本地主动中止时可能返回 `CONN_FAILED = 131`（`0x83`）。只有收到主动关闭状态或工作台关闭指令时才将此码视为正常清理；没有关闭意图的 `131`、原生断言和崩溃仍显示失败原因。

已结束的条目提供“移除会话”，只清除当前工作台的显示记录。移除标记按会话 ID 保留，焦点刷新和后续状态事件不会使条目重新出现；同一连接重新发起的新会话照常显示。活动会话不能通过此入口移除。

### Windows 本机中文输入法与快捷键

远程桌面走物理扫描码输入。Windows 桌面窗口创建 / 获得焦点时停止本机 SDL 文本输入，并用 `ImmAssociateContext` 暂时解除该窗口的本机 IME 上下文关联；销毁前恢复原关联。不切换系统输入法，不影响 Duo SSH 主窗口或其他应用。需要中文组合输入时，使用远端 Windows 的输入法。

Windows 按键转发在发送普通键之前，按该事件自己的 `ev.mod` 快照补齐远端缺失的 Ctrl / Shift / Alt / Win 按下、释放；不使用可能已被后续排队事件改变的全局修饰键状态。实际修饰键事件不重复注入，焦点重同步后清空记录。新增原生序列测试覆盖丢失 Ctrl-down 的 Ctrl+C/V/A/X、丢失 Ctrl-up 后普通输入、左右 Ctrl、Shift 与 AltGr。Windows 窗口测试额外检查本机 IME 解除和重复处理后的原上下文恢复。

本地原生构建、序列回归和 Windows 目标交叉编译已覆盖；微软拼音 / 第三方中文 IME 与完整 Windows 安装包的实际快捷键仍待实机验收，不能把编译检查等同于现场问题复现。

## 检查与测试

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm test:rdp
pnpm test:rdp-worker
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

原生边界测试使用本机临时 TLS 探针，无真实 Windows / 凭据：覆盖协议长度上限、启动前 / 连接中父进程消失、未知 CA 拒绝、正确 pin 进入 CredSSP，以及已被 CA 信任的不同证书仍因错误 pin 被拒绝；显式跳过验证时，自签名和名称不匹配可继续进入 NLA 协商。新增移目录、清理环境、禁用外部 provider 后的 NTLM 加密公开向量自检。测试需要 loopback bind 权限和 openssl CLI；仅缺少该 CLI 时跳过 TLS 探针，Windows 也按实际生产的 CREATE_NO_WINDOW 启动方式验证。

本次 macOS 已通过 Rust 138 项测试（另 1 项按原有规则忽略）、TypeScript / 生产构建、3 项前端状态回归、7 项原生构建回归、5 项原生边界测试，并生成包含 worker / 动态库的隔离 app bundle。原生界面已验证创建配置、一次性密码提交、启动真实 worker、不可达地址错误与手动重连入口；隔离配置使用独立 app identifier，没有读取用户原有连接配置。证书跳过选项另已覆盖旧配置默认严格验证、开启 / 关闭持久化、保留 NLA、指纹恢复及原生自签名 / 名称不匹配的协议回归；该选项尚需真实 Windows Server 验收。

前端回归覆盖迟到事件不复活已结束会话、并发事件不被旧快照删除，以及失败状态不被旧快照覆盖。Rust 覆盖配置验证、严格密码更新请求、迁移幂等与公开 DTO 隐藏 secret reference。

这些检查不能证明真实 Windows 桌面互操作已经通过。当前没有真实 Windows Server 验收结果，Windows native 构建也需由对应 CI / 实机确认；必须继续按 TODO 的长稳、输入、证书、凭据库和安装矩阵验证。Homebrew / vcpkg 的原生依赖基线及实际最小系统版本还需要发行验证：CMake 的 deployment target 不会降低已有第三方库的系统要求，本机开发包不代表支持旧版 macOS。

## 首版限制

- 只支持直连与 NLA，手动重连；SSH 隧道、RD Gateway、自动恢复后续接入。
- 固定远端分辨率、本地窗口缩放；动态分辨率和多显示器后续验证。
- 剪贴板共享默认关闭，可在连接设置选择仅文本或文本和文件，重新连接生效；见[剪贴板接入与验收边界](rdp-clipboard.md)。磁盘、音频与外设重定向保持关闭；没有 AI 桌面读取或操作入口。
- RDP 暂不参与现有 YAML / 加密配置导入导出，SSH 和 S3 的既有行为保持。
- 原生状态仅允许固定协议消息与数字错误码；面向用户的错误由 Rust 映射，不回传远端或库原始诊断文本。
