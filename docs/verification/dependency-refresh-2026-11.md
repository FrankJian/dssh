# 外部依赖更新验证（2026-11-28）

基线提交 `38b41f1`，项目版本仍为 0.7.0。通过官方 npm registry、crates.io、GitHub release 和 Rust stable channel 核对：前端 63 个直接依赖全部检查，21 个有稳定更新；Rust 43 个直接依赖（含 build 与 Unix libc）全部检查。锁文件同时刷新兼容的间接依赖，不强行覆盖上游限定的旧版依赖。

## 保留项

- `keyring` 保留 3.6.3。4.2.0 将后端重组为 keyring-core 与独立存储实现，不能沿用当前 apple-native/windows-native 配置。需要单独验证两平台历史凭据读取，不能仅改版本号。见[官方 4.2 文档](https://docs.rs/keyring/4.2.0/keyring/)。
- `serde_yaml` 已是其最新发布 0.9.34+deprecated，没有新版本可升。换库需要独立覆盖历史导入/导出兼容性，本次没有替换解析器。
- `font-kit`、`portable-pty`、`zmodem2`、`tempfile` 等当前已是稳定最新。encoding_rs/globset/notify 的固定版本已同步升级，仍保留固定约束。
- 更新后 `pnpm outdated --format json` 返回 `{}`，其余前端直接依赖没有更新的 latest 稳定版本。

## 原生与构建依赖

- FreeRDP：3.33.0 → 3.33.1。官方 tag 归档 SHA-256 为 `6b6da1e7217f924b033da6896e70eb4c4a447c3900d03c0d10179062f0a7d495`。同步 Windows 剪贴板局部变量、SDL 事件条件及断开连接入口的上游变化；严格锚点检测保留，证书与剪贴板策略不放宽。见[官方发行说明](https://www.freerdp.com/2026/11/10/3_33_1-release)。
- SDL_ttf 3.2.2 已是官方最新。SDL3、OpenSSL、freetype、json-c 沿用 Homebrew/vcpkg 构建流程解析，没有执行系统包升级。
- pnpm：11.13.1 → 12.23.0；冻结锁文件安装通过，Node 24 保持。默认 npmmirror 在受限环境无法解析，验证显式使用 `--config.registry=https://registry.npmjs.org`，没有修改全局 registry。
- CI Rust：1.97.1 → 官方 stable 1.100.1（2026-11-27 channel）；本机使用附加工具链完成同版本验证，没有修改默认工具链。
- actions/upload-artifact：v7.0.1 → v7.0.2。其他 Actions 已使用覆盖当前最新稳定版的主版本标签：checkout v7、setup-node v7、pnpm/action-setup v6、rust-cache v2、tauri-action v1、msvc-dev-cmd v1。
- CMake/Ninja 安装到临时目录用于本机 RDP 验证，没有改变项目系统工具约定。

## API 兼容适配

- genai 0.7 创建客户端返回 Result，沿用 AppError 的受控错误信息，不输出内部异常或凭据。
- russh 0.65 主机密钥回调改用 PublicKeyOrCertificate，仍对实际公钥执行原 host/port 指纹检查，不把证书颁发者当作自动受信 CA。
- russh-sftp 4 的测试服务使用不透明字节句柄；真实客户端与原文件写入/权限/故障回归继续验证。
- Argon2 0.6 按新接口传入原 16 字节随机盐，保留 PHC；增加旧 0.5.3 公共参考向量的正确/错误密码验证。
- SHA-256 输出显式小写两位十六进制，增加原版本令牌固定向量；JumpServer HMAC 的独立签名向量继续通过。

## 已执行验证

- 前端类型检查、生产构建通过；389 项 Node 模块回归通过，侧栏组件 SSR 和启动预算回归通过。首屏静态 JavaScript 为 690,482 字节，仍低于 900,000 字节预算；功能大分块体积提示仍存在。
- pnpm 12 冻结锁文件安装通过；npm audit 报告 0 个已知漏洞。该结果不等同于 Rust、原生依赖或所有未知问题均无风险。
- Rust 1.100.1：fmt、严格 Clippy 通过；完整测试 304 通过、6 忽略。旧密码和 SHA 编码兼容测试均通过。
- macOS FreeRDP 原生构建通过，构建内键盘修饰键、剪贴板策略、窗口/像素回归通过；独立 worker 的 7 项本机合成服务自检通过。
- 内置浏览器运行真实终端视图：首次加载、加载前快照恢复和输入 `updated` 正常。
- 内置浏览器在模拟文件服务的工作台编辑 README.md：Monaco 0.58 接收输入，Mermaid 12 图表可见（300×49），模拟 PNG 导出显示“PNG 已保存”；切换所见即所得后富文本和图表正常。未读取或修改用户真实文件。

## 验证边界

Windows CI/安装包、真实 SSH/SFTP/JumpServer/S3/模型厂商和两平台系统钥匙串仍需复验。本机模拟服务与 macOS 构建不能替代这些验收。没有发布、推送或创建 release。

本机 RDP 链接出现 Homebrew 原生库面向较新 macOS 构建的 deployment-target 提示，不能据本次构建宣称 macOS 12 已通过。正式包最低系统版本及干净环境仍需验收。原生二进制和 engine.json 由构建脚本生成，未将本机产物加入提交。

## npm 更新明细

| Package | Before | After |
| --- | --- | --- |
| @tauri-apps/api | 2.11.1 | 2.12.5 |
| @tauri-apps/cli | 2.11.4 | 2.12.6 |
| @tauri-apps/plugin-dialog | 2.7.1 | 2.8.4 |
| @tauri-apps/plugin-opener | 2.5.4 | 2.7.3 |
| @tauri-apps/plugin-process | 2.3.1 | 2.4.0 |
| @tauri-apps/plugin-updater | 2.10.1 | 2.14.1 |
| @types/react | 19.2.17 | 19.3.3 |
| @types/react-dom | 19.2.4 | 19.3.0 |
| @vitejs/plugin-react | 6.0.3 | 6.3.0 |
| bowser | 2.15.0 | 2.15.1 |
| cron-parser | 5.10.5 | 5.10.7 |
| figlet | 1.12.0 | 1.13.0 |
| libphonenumber-js | 1.13.16 | 1.13.17 |
| mermaid | 11.16.0 | 12.3.0 |
| monaco-editor | 0.56.0 | 0.58.0 |
| node-forge | 1.4.3 | 1.4.4 |
| react | 19.2.7 | 19.3.1 |
| react-dom | 19.2.7 | 19.3.1 |
| sql-formatter | 15.9.0 | 15.10.0 |
| typescript | 6.0.3 | 7.0.2 |
| vite | 8.1.3 | 8.4.0 |

## Rust 完整核对清单

原约束来自基线 Cargo.toml，当前约束来自更新后清单；具体解析版本固定在 Cargo.lock，同名传递依赖可能保留多版本。

| Crate | Previous constraint | Current constraint | Latest stable |
| --- | --- | --- | --- |
| aes-gcm | 0.11.0 | 0.11.1 | 0.11.1 |
| argon2 | 0.5.3 | 0.6.0 | 0.6.0 |
| aws-config | 1.9.0 | 1.13.4 | 1.13.4 |
| aws-credential-types | 1.3.0 | 1.3.1 | 1.3.1 |
| aws-sdk-s3 | 1.138.0 | 1.162.0 | 1.162.0 |
| aws-smithy-types | 1.6.1 | 1.9.5 | 1.9.5 |
| base64 | 0.22.1 | 0.23.1 | 0.23.1 |
| cookie | 0.18.1 | 0.18.3 | 0.18.3 |
| encoding_rs | =0.8.35 | =0.8.44 | 0.8.44 |
| flate2 | 1 | 1.1.11 | 1.1.11 |
| font-kit | 0.14.3 | 0.14.3 | 0.14.3 |
| futures | 0.3 | 0.3.34 | 0.3.34 |
| genai | 0.6 | 0.7.6 | 0.7.6 |
| globset | =0.4.20 | =0.4.22 | 0.4.22 |
| hmac | 0.12.1 | 0.13.0 | 0.13.0 |
| httpdate | 1 | 1.0.3 | 1.0.3 |
| keyring | 3.6 | 3.6 | 4.2.0 |
| libc | 0.2 | 0.2.191 | 0.2.191 |
| notify | =8.2.0 | =9.0.0 | 9.0.0 |
| percent-encoding | 2 | 2.3.2 | 2.3.2 |
| portable-pty | 0.9.0 | 0.9.0 | 0.9.0 |
| rand | 0.10.2 | 0.10.4 | 0.10.4 |
| reqwest | 0.13 | 0.13.5 | 0.13.5 |
| rusqlite | 0.40.1 | 0.43.0 | 0.43.0 |
| russh | 0.62 | 0.65.4 | 0.65.4 |
| russh-sftp | 2 | 4.0.0 | 4.0.0 |
| rustls-native-certs | 0.8.4 | 0.8.5 | 0.8.5 |
| serde | 1 | 1.0.229 | 1.0.229 |
| serde_json | 1 | 1.0.154 | 1.0.154 |
| serde_yaml | 0.9 | 0.9 | 0.9.34+deprecated |
| sha2 | 0.10.9 | 0.11.2 | 0.11.2 |
| tauri | 2 | 2.12.7 | 2.12.7 |
| tauri-build | 2 | 2.7.6 | 2.7.6 |
| tauri-plugin-clipboard-manager | 2.3.2 | 2.5.0 | 2.5.0 |
| tauri-plugin-dialog | 2 | 2.8.4 | 2.8.4 |
| tauri-plugin-opener | 2 | 2.7.3 | 2.7.3 |
| tauri-plugin-process | 2.3.1 | 2.4.0 | 2.4.0 |
| tauri-plugin-updater | 2.10.1 | 2.14.1 | 2.14.1 |
| tempfile | 3.27.0 | 3.27.0 | 3.27.0 |
| tokio | 1.52.3 | 1.54.1 | 1.54.1 |
| tokio-util | 0.7 | 0.7.20 | 0.7.20 |
| zeroize | 1.9 | 1.9.2 | 1.9.2 |
| zmodem2 | =0.7.3 | =0.7.3 | 0.7.3 |
