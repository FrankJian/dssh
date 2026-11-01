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

首版不含自动发现证书 / 首次信任弹窗。保存指纹是显式信任操作；证书更换需管理员重新核对后编辑。RDP 也不保证共享当前物理屏幕，不支持把 Windows Home 用作内置 RDP 服务端。

## 本地构建与运行

日常前端与 Rust 检查不要求安装 RDP 编译依赖。需要实际打开桌面时，先构建原生引擎。

macOS 构建依赖：CMake、Ninja、SDL3、OpenSSL 3/4、FreeType、json-c。Apple Silicon 默认使用 `/opt/homebrew`；Intel / 自定义前缀可设置 `DSSH_RDP_PREFIX`。脚本构建固定 SDL_ttf 3.2.2，FreeRDP 固定 3.32.2。

```sh
pnpm rdp:build
pnpm tauri dev
```

Windows 在 MSVC Developer PowerShell 中配置 CMake / Ninja 和 VCPKG_ROOT，先安装：

```powershell
vcpkg install sdl3 sdl3-ttf openssl json-c --triplet x64-windows-static-md
pnpm rdp:build
pnpm tauri dev
```

产物写到被 gitignore 的 `src-tauri/rdp-runtime/`，包含 worker 和运行库；缓存写到 `.cache/rdp/`。脚本可使用 `DSSH_RDP_ARCHIVE` / `DSSH_RDP_TTF_ARCHIVE` 指定离线源包，但仍强制校验摘要。

包含原生引擎的本地安装包：

```sh
pnpm rdp:package
```

CI 的安装包与 release 工作流已增加原生构建 action 和 `tauri.rdp.conf.json` 资源覆盖。直接运行不带覆盖的 `pnpm tauri build` 不会自动包含原生资源；界面会明确提示引擎缺失。

构建脚本重定位 macOS 动态库，附带 FreeRDP 和依赖许可证，使用本地 ad-hoc 签名。正式发行仍需检查最终依赖清单和许可证材料，并用发行身份对所有 native 组件签名和做干净系统验收；不依赖用户安装 Homebrew 或 XQuartz。

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

原生边界测试使用本机临时 TLS 探针，无真实 Windows / 凭据：覆盖协议长度上限、启动前 / 连接中父进程消失、未知 CA 拒绝、正确 pin 进入 CredSSP，以及已被 CA 信任的不同证书仍因错误 pin 被拒绝；显式跳过验证时，自签名和名称不匹配可继续进入 NLA 协商。测试需要 loopback bind 权限；Windows 上 TLS 探针暂跳过，仅运行协议 / 生命周期检查。

本次 macOS 已通过 Rust 135 项测试（另 1 项按原有规则忽略）、TypeScript / 生产构建、3 项前端状态回归、4 项原生边界测试，并生成包含 worker / 动态库的隔离 app bundle。原生界面已验证创建配置、一次性密码提交、启动真实 worker、不可达地址错误与手动重连入口；隔离配置使用独立 app identifier，没有读取用户原有连接配置。证书跳过选项另已覆盖旧配置默认严格验证、开启 / 关闭持久化、保留 NLA、指纹恢复及原生自签名 / 名称不匹配的协议回归；该选项尚需真实 Windows Server 验收。

前端回归覆盖迟到事件不复活已结束会话、并发事件不被旧快照删除，以及失败状态不被旧快照覆盖。Rust 覆盖配置验证、严格密码更新请求、迁移幂等与公开 DTO 隐藏 secret reference。

这些检查不能证明真实 Windows 桌面互操作已经通过。当前没有真实 Windows Server 验收结果，Windows native 构建也需由对应 CI / 实机确认；必须继续按 TODO 的长稳、输入、证书、凭据库和安装矩阵验证。Homebrew / vcpkg 的原生依赖基线及实际最小系统版本还需要发行验证：CMake 的 deployment target 不会降低已有第三方库的系统要求，本机开发包不代表支持旧版 macOS。

## 首版限制

- 只支持直连与 NLA，手动重连；SSH 隧道、RD Gateway、自动恢复后续接入。
- 固定远端分辨率、本地窗口缩放；动态分辨率和多显示器后续验证。
- 剪贴板、文件 / 磁盘、音频与外设重定向默认关闭；没有 AI 桌面读取或操作入口。
- RDP 暂不参与现有 YAML / 加密配置导入导出，SSH 和 S3 的既有行为保持。
- 原生状态仅允许固定协议消息与数字错误码；面向用户的错误由 Rust 映射，不回传远端或库原始诊断文本。
