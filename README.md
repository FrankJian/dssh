# Duo SSH

Duo SSH 是一个轻量、跨平台（Windows / macOS）的 SSH 管理桌面应用，使用 Rust + Tauri 2 + React + TypeScript 构建。仓库、内部包名和部分构建产物仍使用 `dssh`。

界面采用**工作区布局**——左侧活动栏、会话树侧栏、顶部标签页、右侧可停靠面板（AI / 主机工具）——配以冷紫罗兰的 **Violet / Nebula** 主题，风格紧凑、接近原生 IDE。

## 功能

**连接与会话**
- SSH 连接配置的本地管理（增删改查，SQLite 存储），密码 / 密钥认证，SOCKS5 / HTTP 代理
- **会话树**：连接后按主机聚合成节点，展开即可新建终端 / 打开 SFTP / 端口转发 / 断开；一台主机可并行多个终端；下方提供收藏的快捷启动入口
- **连接管理器**：搜索、排序（最近 / 名称 / 主机）、网格·列表·分组视图、最近使用、连接卡片、YAML 明文 + 加密（Argon2id + AES-256-GCM）导入导出
- **优雅重连**：SSH 会话断线后 30s 宽限内自动重连（指数退避，可随时取消）；正常 `exit` 不会重连
- **共享连接池**：同一连接配置的终端、SFTP、端口转发、主机工具与 AI exec 复用 SSH transport，并使用彼此独立的 channel；transport 故障可统一恢复
- **主机密钥 TOFU 校验**：首次连接确认指纹并记住，指纹变更时拒绝并告警
- 多会话终端、内置本地终端（PowerShell / bash 等），基于 xterm.js（ANSI 颜色、UTF-8 / 中文、复制粘贴、自适应尺寸、`Ctrl`+滚轮 与 `Ctrl` ± / 0 调整字号、可选 WebGL 渲染）

**终端与工作区**
- **分屏**：同一标签内最多 4 个终端，可针对当前面板继续横向或纵向拆分并拖拽调整比例；新分出的面板**自动连接到当前所在主机**（本地面板则开本地 shell）
- **标签页**：终端与 SFTP 统一在顶部标签条，支持拖拽重排、中键关闭，以及拆到独立原生窗口；合并回主窗口时保留 session、输出与分屏布局
- **命令面板（⌘K / Ctrl+K）**：模糊搜索连接、已打开的标签页，以及各类动作（分屏、重连、打开 SFTP / 端口转发、切换面板与主题、折叠侧栏、禅模式等）
- **终端外观**：可选背景图片 + 背景不透明度调节（调低即透出图片或应用背景）
- **禅模式**：一键隐藏所有外壳，专注终端（Esc 退出）

**文件、对象存储与运维**
- SFTP 双栏文件浏览与传输（远端 / 本机浏览、上传 / 下载、批量与目录传输、取消、路径选择），以标签页形式按主机打开
- **远程 Explorer**：树状目录、路径根节点、多选、本机拖入上传、新建 / 重命名 / 移动 / 递归删除 / 权限属性；支持文本编辑、图片显示和可拖拽的 Markdown 预览
- **Monaco 远程编辑器**：代码高亮、行号、折叠、查找替换、多光标、手动语言选择、未保存保护和快捷保存
- S3 / S3-compatible 对象浏览器（详见下文）
- 端口转发（本地 `-L` / 远程 `-R` / 动态 SOCKS5），随 SSH 会话自动清理
- **主机工具面板**：在当前连接上执行只读命令，查看监控 / 进程 / 服务 / 日志 / 端口
- 内置 AI 运维助手（基于 ReAct 的 Agent，详见下文）

**其他**
- 设置中心：外观、终端（字体 / 鼠标 / GPU 渲染 / 背景）、S3 并发、AI 后端、配置文件导入导出
- 自定义无边框窗口、深色 / 浅色 / 跟随系统主题、自动更新（支持配置代理）

## AI 助手

内置一个基于 **ReAct（推理 + 行动）** 的 AI 运维助手，以对话的方式帮助你排查问题、查看状态与执行运维操作：

- **模型后端可配置**：兼容任意 OpenAI 风格的接口（OpenAI、DeepSeek、OpenRouter、Ollama、vLLM、各类聚合网关等）。在「设置 → AI」中填写 API 地址（需以 `/v1/` 结尾）、密钥，可一键拉取模型列表并选择，支持配置多个后端。另支持 **GitHub Copilot** 设备码登录。
- **代理访问**：每个模型后端可单独配置代理（`http` / `https` / `socks5`），便于在受限网络下访问。
- **工具调用（Agent）**：助手可调用工具完成实际操作——
  - `list_servers`：列出已保存的服务器配置；
  - `run_command`：通过 SSH 在指定服务器上执行命令（**执行前需用户确认**）；
  - `read_terminal`：读取当前交互式终端中的输出内容，遇到报错时无需手动复制粘贴，助手可自动读取并分析。
- **富文本回答**：回答以 Markdown 渲染，支持表格、代码块、列表等。

> 首次使用：点击活动栏的 AI 图标打开**右侧助手面板** → 打开「模型配置」填写后端信息并选择模型 → 连接一台 SSH 服务器后即可开始对话。

## S3 对象浏览器

左侧活动栏的 S3 入口提供独立的对象存储工作区：左侧管理 AWS S3 或 S3-compatible 连接，右侧浏览存储桶、前缀与对象。连接配置采用 WinSCP 风格的主机名、端口和 TLS 加密选项，并支持 Access Key、可选 Session Token 与 path-style；Secret Access Key 不会返回前端，并随配置文件密码加密导入导出。

- 上传、拖拽上传与流式下载，大文件自动使用 multipart upload；
- 新建目录标记、删除、复制和移动对象，支持分页列出大量对象；
- 上传 / 下载进度显示；
- 可为配置指定默认存储桶和默认上传 canned ACL；
- 对单个对象设置 `private`、`public-read`、`public-read-write` 或 `authenticated-read`。若存储端禁用了 ACL，错误原因会直接显示且不影响其他操作。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 后端 | Rust edition 2024（`russh` SSH 共享连接池 + 主机密钥 TOFU、`russh-sftp` 文件传输、`portable-pty` 本地终端、`rusqlite` 存储、`aws-sdk-s3`、`argon2` + `aes-gcm` 加密导出） |
| AI | `genai`（多后端 LLM 客户端）、`reqwest`（HTTP / 代理） |
| 前端 | React 19 + TypeScript + Vite 8 |
| 终端 | xterm.js（`@xterm/xterm` + fit / web-links / webgl 插件） |
| 编辑器 | Monaco Editor（ESM + 独立 worker） |
| Markdown | `react-markdown` + `remark-gfm` |
| 包管理 | pnpm |

## 环境要求

- [Node.js](https://nodejs.org/) 18+ 与 [pnpm](https://pnpm.io/)（`npm i -g pnpm`）
- [Rust](https://www.rust-lang.org/tools/install) 稳定版工具链（含 `cargo`）
- Tauri 平台依赖（见官方文档 [Prerequisites](https://tauri.app/start/prerequisites/)）：
  - **Windows**：Microsoft Visual Studio C++ Build Tools、WebView2 Runtime
  - **macOS**：Xcode Command Line Tools（`xcode-select --install`）

## 快速开始

安装依赖：

```sh
pnpm install
```

启动开发环境（同时拉起 Vite 前端与 Tauri 桌面窗口，支持热重载）：

```sh
pnpm tauri dev
```

> 开发时改动前端会即时热更新；改动 `src-tauri` 下的 Rust 代码会自动重新编译并重启窗口。
> 修改 `src-tauri/capabilities/` 后需要完全停止并重新运行 `pnpm tauri dev`，仅刷新或等待前端热更新不会加载新的窗口权限。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm tauri dev` | 启动桌面开发环境（推荐日常开发使用） |
| `pnpm dev` | 仅启动 Vite 前端（浏览器打开无 Tauri 后端桥接，`invoke` 不可用，仅用于纯前端调试） |
| `pnpm build` | 类型检查并构建前端产物（`tsc && vite build`，输出到 `dist/`） |
| `pnpm exec tsc --noEmit` | 仅做前端类型检查 |
| `cd src-tauri && cargo check` | 快速检查 Rust 后端能否编译 |
| `cd src-tauri && cargo fmt` | 格式化 Rust 代码 |
| `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Lint（与 CI 一致） |
| `cd src-tauri && cargo test` | 运行 Rust 测试 |

## 打包（生成安装包 / 可执行文件）

```sh
pnpm tauri build
```

产物位于 `src-tauri/target/release/`：

- 可执行文件：`src-tauri/target/release/dssh.exe`（Windows）
- 安装包：`src-tauri/target/release/bundle/` 下的 MSI / NSIS（Windows）或 `.dmg` / `.app`（macOS）

> 若处于受限网络，`cargo` 可能需要代理才能拉取依赖，例如：
>
> ```powershell
> $env:HTTP_PROXY='http://<proxy-host>:<port>'; $env:HTTPS_PROXY='http://<proxy-host>:<port>'; pnpm tauri build
> ```

## 持续集成

`.github/workflows/ci.yml` 在 PR 与 `main` 推送时于 macOS 和 Windows 上运行：

- `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`
- `pnpm exec tsc --noEmit`、`pnpm build`

提交前建议本地跑一遍相同命令（见上方「常用命令」），避免 CI 红灯。

## 自动更新（Auto Update）

应用启动时会自动读取 GitHub Release 上的 `latest.json`；若发现更高版本，会弹出提示，可直接下载、校验签名、安装并自动重启。也可以在「设置 → 关于 → 检查更新」手动检查更新。

- **更新源**：仅检查 GitHub Release
  （`https://github.com/FrankJian/dssh/releases/latest/download/latest.json`），配置在
  `src-tauri/tauri.conf.json` 的 `plugins.updater.endpoints`。
- **代理**：若因网络问题检查失败，可在「设置 → 关于 → 更新代理」填写代理地址
  （如 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:1080`）后重试；该地址同时用于下载更新包，留空表示直连。
- 更新失败时会逐条列出每个更新源的访问结果，便于判断是网络、代理还是清单签名的问题。

> 自动更新仅在**已安装的正式版本**中可用，`pnpm tauri dev` 下无法真正执行更新。

### 签名密钥

更新包必须使用私钥签名，客户端用内置公钥校验，防止更新包被篡改。

- 私钥：`release/updater/dssh_updater.key`（**务必保密**）。
- 公钥：`release/updater/dssh_updater.key.pub`，其内容已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- 该密钥生成时未设置密码；如需更强安全性，可用 `pnpm tauri signer generate` 重新生成并同步更新公钥。

> ⚠️ 私钥一旦丢失且无备份，将无法再为老版本推送可被验证的更新。

### 发布新版本（打 tag 触发）

`.github/workflows/release.yml` 会在推送 `v*` tag 时构建 **macOS Apple Silicon**、**macOS Intel** 与 **Windows x64** 三个平台，签名后上传到一个**草稿 Release**；全部平台构建完成后再自动取消草稿正式发布——这样更新器不会在构建过程中读到只包含部分平台的 `latest.json`。

**一次性准备**：在仓库 **Settings → Secrets and variables → Actions** 中新增 secret：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥内容（`release/updater/dssh_updater.key` 的**全部文本**）。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：密钥密码。当前密钥为空密码，**可不创建**（未配置时 Actions 会以空字符串传入）。

**发布流程**：

```sh
# 1. 修改 src-tauri/Cargo.toml 的 version（如 0.4.10 → 0.5.0）并提交
# 2. 打一个与版本号一致的 tag（前缀 v）并推送
git tag v0.5.0
git push origin v0.5.0
```

工作流会先校验 **tag（去掉 `v`）与 `Cargo.toml` 的 `version` 一致**（若 `tauri.conf.json` 显式写了 `version` 也一并校验），不一致直接失败，防止误发。

> 触发方式仅为**打 tag**，普通 `git push` 不会触发发布。

### 本地带签名构建（可选）

需要在本地产出带 `.sig` 的安装包时，构建前设置签名环境变量：

macOS / Linux（bash）：

```sh
export TAURI_SIGNING_PRIVATE_KEY="$(cat ./release/updater/dssh_updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm tauri build
```

Windows PowerShell：

```powershell
# 用 .Trim() 去掉可能的换行，否则签名会报 "Invalid symbol 10"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content ".\release\updater\dssh_updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`：Windows 为 `nsis/dssh_<版本>_x64-setup.exe` 及其 `.sig`；macOS 为 `macos/dssh.app.tar.gz` 及其 `.sig`（更新用的是 `.app.tar.gz`，不是 `.dmg`）。

> PowerShell 中给环境变量赋空字符串等于删除该变量，Tauri 会弹出 `Password:` —— **直接回车即可**（空密码）。
> 想完全免交互可改用 Git Bash 构建，或给密钥设置一个非空密码。

## 数据与安全

- SSH 配置保存在操作系统的应用数据目录（SQLite），不会写入仓库。已信任的主机密钥指纹保存在同目录的 `known_hosts.json`。
- **主机密钥校验（TOFU）**：首次连接某主机会弹出指纹确认，信任后记住；之后指纹若变更会被拒绝并告警，可防中间人攻击。
- 密码、密钥内容及口令目前以明文形式存储于本地数据库；配置文件导出的 YAML 同样包含上述敏感信息。**接入系统密钥链（keychain）是计划中的改进**（见 [TODO.md](TODO.md)）——在此之前请勿存放敏感生产凭据，并妥善保管导出的配置文件。
- 凭据仅在 Rust 侧解析使用，不会下发到前端或写入日志。

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
