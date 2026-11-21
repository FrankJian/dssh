# 终端 ZMODEM 与 JumpServer 文件传输规格

> 当前行为契约：[terminal-file-transfer](../../openspec/specs/terminal-file-transfer/spec.md)。本文用于使用或实现说明，不另行扩展行为承诺。

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


> 状态：终端 `rz` 上传与 `sz` 下载首版已接入，尚待真实 SSH/`lrzsz` 互操作验收；JumpServer SFTP 定制未实现。调研日期：2026-10-14。
> 本文覆盖终端执行 `rz` 上传、`sz` 下载文件，以及通过 JumpServer 将文件上传到指定资产目录。
> 依据为当前仓库代码、官方文档和上游源码；用户环境的 JumpServer 版本、平台配置与登录方式仍待补充。

## 1. 结论与推荐范围

1. **可以支持 `rz` 与 `sz`。** 两个方向均在 SSH PTY 原始字节进入 UTF-8 解码之前分流；`rz` 使用本地发送端，`sz` 使用本地接收端。单纯增加文件选择弹窗或 xterm 插件不够。
2. **可以改善 JumpServer 指定目录上传，但不能承诺任意目录都可写。** 首选两种受支持的方式：由管理员配置资产平台的 SFTP 根目录；或在已获授权的目标资产终端中进入目标目录，再通过 `rz` 上传。后者需要资产安装 `lrzsz`、JumpServer 允许该类传输、当前账号有目录写权限。
3. **不能把“文件落入 tmp”直接定性为 Duo SSH 的路径丢失。** 当前上传代码会传递完整目标路径；但目录列表依赖服务器的 `REALPATH` 返回值重建后续路径，仍可能有兼容性问题。必须分开验证客户端路径、JumpServer 虚拟路径和资产实际落盘路径。
4. 已交付 **ZMODEM 上传与下载**；JumpServer 路径说明/诊断和指定终端上传引导仍是后续阶段；“SFTP 暂存后自动搬运”不进入首版。

本提案中的“成功”需要区分：协议完成、SFTP 命名空间内文件验证、资产真实路径验证。不能只因为已发送全部字节，就显示“已上传到资产指定目录”。

## 2. 当前实现核查

### 2.1 终端链路

| 代码位置 | 当前行为 | 对 ZMODEM 的影响 |
| --- | --- | --- |
| `src-tauri/src/ssh/session_manager.rs`：`connect_and_run` | 将 SSH `Data` 和 `ExtendedData` 合并送入 `decode_with_carry` | 没有协议分流；二进制可能在解码时被修改 |
| 同文件：`decode_with_carry` | 保留跨包 UTF-8 字符；用 U+FFFD 替换非法字节 | 正常文本处理合理，但不能作为文件协议的数据源 |
| 同文件：`SessionCommand::Input(String)`、`write_session` | 键盘输入为字符串，再转为 UTF-8 字节；有交互式 `exit/logout` 检测 | 不能借用字符串输入承载任意文件字节；协议帧也不能进入退出命令检测 |
| 同文件：`OutputSink` | 文本按 16 KiB / 4ms 合并，再进入快照与输出事件 | 协议分流应在此之前；保持普通终端已有合并行为 |
| `src/services/sshSessionService.ts`、`src/terminal/useTerminalSessions.ts` | `terminal-output.data` 为字符串 | 到前端再探测时，原始字节已不可恢复 |
| `src/terminal/terminalRegistry.ts` | xterm 输入和渲染；前端实例生命周期管理 | 应展示传输状态，不承担文件协议所有权 |

现有依赖和源码中没有 ZMODEM 引擎。首版只处理 Duo SSH 管理的 SSH PTY；从本地终端再运行外部 `ssh` 的场景单独评估，不默认纳入支持范围。

### 2.2 SFTP 链路

| 代码位置 | 已确认行为 | 需核查的边界 |
| --- | --- | --- |
| `src/sftp/FileBrowser.tsx`：`uploadSelected` | 用当前远程路径与文件名拼接上传目标 | `loadRemote` 会用 `listing.path` 替换导航路径 |
| `src/sftp/RemoteFileTree.tsx`：`uploadFiles` | 将选中/拖放目标目录与文件名拼接后上传 | 需要覆盖工具栏、右键和拖放入口，不能只验证一个入口 |
| `src/services/sftpService.ts`、`src-tauri/src/commands/sftp.rs` | 将 `remotePath` 传给 Rust SFTP manager | 没有 JumpServer 专用路径上下文 |
| `src-tauri/src/sftp/mod.rs`：`list` | `read_dir(target)` 后 `canonicalize(target)`，再以 canonical 路径拼接条目 | 若网关返回的路径不能再次作为同一命名空间的请求路径，会影响后续上传 |
| 同文件：`upload` | `open_with_flags(remote_path, CREATE | TRUNCATE | WRITE)`，64 KiB 分块写入，关闭后报告完成 | 未验证资产真实目录；当前代码中没有硬编码改写为 `/tmp` |
| 同文件：`open_connection` | 从共享连接池另开 SFTP subsystem channel | 与交互式终端是不同 channel，不能继承终端内选中的资产或 `cd` 状态 |

“同一 profile / 同一 transport”不等于“同一目标资产 / 账号 / shell 当前目录”。这也是定制方案最需要明确的边界。

### 2.3 JumpServer 上游证据与适用范围

- 官方说明：SFTP 默认目录是 `/tmp`，可通过新建平台、修改其 SFTP 目录并将平台关联到资产来调整。这是服务端配置，不是客户端 `cd` 设置。[官方配置说明](https://www.jumpserver.com/blog/jumpserver-sftp-default-path-configuration)
- KoKo 当前 `dev` 源码的 `AssetDir.GetRealPath` 将资产内虚拟路径拼到配置的根目录下；创建文件还会检查上传权限。`UserSftpConn` 则处理节点/资产路径。该源码说明存在路径映射层，不能作为用户部署版本的精确行为保证。[资产路径实现](https://github.com/jumpserver/koko/blob/dev/pkg/srvconn/sftp_asset.go)、[虚拟目录实现](https://github.com/jumpserver/koko/blob/dev/pkg/srvconn/sftpconn.go)
- 官方 v2.12.0 发布说明已介绍通过 Terminal / Web Terminal 使用 `rz`、`sz`，并要求资产安装 `lrzsz`。这是方案可行的历史依据；实际支持仍需检查部署版本和授权策略。[官方发布说明](https://www.jumpserver.org/blog/release-20210719.html)

示意：若某资产的 SFTP 根被配置为 `/tmp`，其资产内虚拟 `/reports/a.txt` 可能对应资产 `/tmp/reports/a.txt`，而非 `/reports/a.txt`。完整 SFTP 路径还可能包含节点、资产、账号前缀。**不能据此断言所有子目录都会被扁平化到 `/tmp`，也不能对所有 JumpServer 版本硬编码这一映射。**

## 3. 产品行为

### 3.1 在终端输入 `rz`

1. 用户已进入远程 shell，可先自行执行 `cd /目标目录`，再执行 `rz`；需要二进制模式时可使用服务端支持的 `rz -b`。
2. 后端增量探测有效 ZMODEM 初始化帧，终端显示“远端请求接收文件”，打开原生多文件选择器。文件选择即本次发送的用户确认；确认前不得自动发送握手响应或读取文件。
3. 选择后，在原 SSH PTY channel 上发送所选普通文件；不额外创建 SFTP 或 SSH 连接。
4. 显示当前文件、总文件数、已传字节、进度与取消按钮。当前 pane 暂停普通输入/粘贴，其他 pane 正常工作。
5. 完成后恢复终端。未经验证的目标路径显示“远端 `rz` 的工作目录”；不从提示符推测路径，也不承诺目标文件未被服务器改名。

只发送用户选择的文件，不自动枚举邻近目录。首版支持多选文件，不递归上传目录，不自动压缩目录，不自动安装远端软件。

### 3.2 取消必须结束本次传输

- 文件选择器取消、传输条取消、超时与远端终止都进入唯一的终态；重复初始化帧不能重新弹窗。
- 区分“被动探测、尚未确认”和“已确认协议传输”：普通终端输出不会自动触发协议写入；用户明确取消文件选择或传输时，发送标准 ZMODEM 终止序列（CAN + 退格）使远端 `rz` / `sz` 退出。
- 选择器取消后先向远端发送终止序列，再恢复正常输入；若远端仍未退出，提示用户按 Ctrl+C 或关闭该终端。同一轮重复握手保持抑制。
- 已确认传输取消后，等待有限时间清理协议尾部，恢复可用终端；无法确定远端已退出协议时，显示“远端状态未确认”，由用户中断远端程序或关闭该终端。不得盲目追加回车、重放已排队输入或自动重试上传。
- 取消传输不关闭共享 SSH transport，不影响同主机其他终端、SFTP、转发。远端可能保留部分文件，必须提示，不擅自删除未知文件。

### 3.3 在终端输入 `sz`

1. 后端探测远端发送端的有效 ZMODEM 初始化帧后，显示保存位置请求；用户选择一个本地文件夹后才发送接收端握手。
2. 文件按远端声明的安全文件名写入所选目录，不允许路径分隔符、盘符、控制字符或 Windows 保留设备名；不接收未声明大小或超过协议 4 GiB 上限的文件。
3. 同名普通文件会暂停接收并询问“覆盖 / 跳过”，默认跳过；等待超时也跳过。覆盖先写入同目录临时文件，完整接收后才替换原文件；取消或失败时保留原文件。多文件 `sz` 保持各自的远端文件名。
4. 显示当前文件、文件数、进度与取消按钮。文件内容和协议帧不进入终端滚屏、前端 IPC 或日志；取消时本地可能保留部分文件。

### 3.4 JumpServer 专用体验

连接编辑器新增“文件传输兼容性”：`自动` / `标准 SSH` / `JumpServer`。旧连接默认自动。自动识别只给出建议，不因端口 2222、主机名或 banner 单一特征切换写入策略。

JumpServer 模式提供：

- SFTP 地址栏明确标注“网关 SFTP 路径”；有资产/账号信息时一起展示，未知时如实显示未知。
- 显示可配置的“资产 SFTP 根目录说明”。管理员或用户提供的映射仅用于说明，标注来源与是否验证；不能通过此字段修改服务端根目录。
- 显示说明：“该路径可能位于资产配置的 SFTP 根目录下；需要其他目录时，可调整服务端平台配置，或通过已授权的资产终端使用 rz。”
- 增加“通过终端上传到指定目录”入口，显式选择终端 **pane/session**。一个堡垒机 profile 下可能有多个终端，不能自动选择同 profile 的第一个终端。
- 用户确认该终端已进入目标资产 shell，填写资产上的绝对目录。首版生成可检查的 POSIX shell 命令，例如 `cd '/opt/app/releases' && pwd -P && rz -b`，由用户插入终端并按回车执行；目录切换失败时不得继续运行 `rz`。
- 命令生成器正确处理空格、单引号及中文，拒绝 NUL、换行和其他控制字符；不插值执行 `$()`、反引号、通配符或环境变量。此入口只适用于已确认的 POSIX shell，不向资产选择菜单、密码提示或全屏程序自动注入命令。
- 文件选择器展示“请求目录：…；实际目录以终端输出为准”。仅凭该命令的文本或提示符不能标记“路径已验证”。

该入口复用 3.1 的上传链路。它不把 SFTP 虚拟路径直接用作 shell 路径，也不假设新开的 exec channel 会自动进入用户刚才在终端中选择的资产。

### 3.4 方案选择

| 场景 | 推荐路径 | 可以承诺的结果 |
| --- | --- | --- |
| 标准 SSH，SFTP 可访问目标目录 | 既有 SFTP | 写入服务器 SFTP 命名空间中的指定路径 |
| JumpServer 的 SFTP 根已覆盖目标目录 | SFTP + 正确虚拟路径上下文 | 在被授权的目录范围内上传 |
| SFTP 根不覆盖目标目录，资产 shell 允许 `rz` | 当前目标终端 `cd` 后 `rz` | 文件交给该资产 shell 中的接收程序，权限仍由远端决定 |
| 有管理员协助 | 配置自定义平台的 SFTP 根并重新连接验证 | 长期使用 SFTP 的推荐方案 |
| `rz` 不存在或策略禁止文件上传 | 说明原因并引导管理员处理 | 不能由客户端保证指定目录上传 |
| 只有 SFTP 权限，无目标 shell | 在已授权根内上传或管理员调整根 | 不提供自动 shell 搬运 |

## 4. ZMODEM 技术设计

### 4.1 所有权与原始字节分流

推荐在 Rust 侧实现进程级 `TerminalTransferManager`，每个 SSH terminal session 持有独立协议状态。与既有连接池共存，使用该终端已持有的 channel，不重新认证。

```text
SSH PTY Data 原始字节
        │
        ▼
ZMODEM 增量探测 / 会话分流（Rust，按 session + channel generation）
        ├─ 普通终端字节 → decode_with_carry → OutputSink → xterm / 文本快照
        └─ 协议帧       → ZMODEM 引擎 ↔ 本地分块文件 IO
                              │
                              ├─ 原始响应字节 → 原终端唯一 writer
                              └─ 元数据/进度 → 当前归属窗口
```

- 分流发生在 UTF-8 解码、文本合并、滚屏缓存、AI `read_terminal` 之前。文件载荷、控制帧不进入这些文本通路。
- `ExtendedData` 保持独立的诊断/显示路径；不把 stderr 拼接进 ZMODEM 协议流。
- 增量探测必须覆盖任意 SSH 分包、多个帧合包、普通文本与协议头混合。候选头长度有界；候选失败时按原顺序回放普通字节，不能丢字节或重复渲染。
- 新增原始字节发送分支；键盘字符串输入与协议字节输入共用一个有序 writer，但类型、权限和退出检测分开。不得通过 `String::from_utf8_lossy` 或 JS 字符串往返协议载荷。
- 独占期间后端也拒绝普通输入，包括粘贴、AI 终端写入、宏及 xterm 自动响应；不能只禁用 UI。resize、取消、关闭走独立控制路径。
- IO 与协议处理采用有界队列和流控；控制命令不能被大文件队列饿死。不丢弃有效文件帧来缓解积压，不将整文件载入内存。
- 在现有终端文本性能优化上增量接入。旧性能规格部分审计内容已滞后，实施以当前代码为准，不重复重做已存在的 `OutputSink` 或终端 registry。

### 4.2 引擎选择与实施门禁

架构选择为 **Rust 管理协议与文件 IO**。首版已固定使用 `zmodem2 = 0.7.3`：其 caller-driven `Sender` / `Receiver` API 支持增量读写文件、CRC 校验、重试/确认与取消；许可证为 MIT OR Apache-2.0。该选型已通过本机 Rust 编译，但尚未完成与真实 `rz`/`sz`/`lrzsz` 的互操作验收，不能把编译通过视为协议兼容性证明。

| 候选 | 定位 | 决策 |
| --- | --- | --- |
| `zmodem2 = 0.7.3` | Rust 发送端与接收端；文件按块读写，协议状态由应用驱动 | 已集成；Windows/macOS 构建与真实 `lrzsz` 互操作仍待验收 |
| `zmodem.js` | 已有二进制探测、发送/接收实现，可用于对照实验 | 备选；若在 WebView 运行，需额外解决二进制 IPC、唯一消费者、窗口生命周期和流式文件 IO |
| 外部 `sz/rz` 子进程 | 可作为受控互操作测试工具 | 不作为首版部署依赖；Windows 打包和终端流对接需另行设计 |

`zmodem.js` 文档明确其协议流需要二进制输入，并列有实现限制；不能直接照搬浏览器整文件保存示例作为桌面大文件实现。[上游说明](https://github.com/FGasper/zmodemjs)

Rust 引擎文档：[zmodem2 文档](https://docs.rs/zmodem2)。本首版在 Rust 侧完成双向增量探测、SSH 原始字节分流、分块文件 IO、进度和取消；没有将传输数据转为文本，也不会在用户选择上传文件或下载目录前向远端发送协议响应。

### 4.3 探测、确认与安全

被动读取到有效协议头不等于用户启动了传输：`cat` 日志或恶意文件也可能输出相同字节。已有终端产品出现过自动确认 ZMODEM 后将响应写回 shell 的安全问题。[Tabby 上游安全公告](https://github.com/Eugeny/tabby/security/advisories/GHSA-qr3x-j8g9-xhf6)

因此本方案要求：

- 探测只产生 UI 请求；用户选择文件/保存位置后才允许产生协议响应。检查校验和与帧结构，但不能把 CRC 合法当成授权。
- 每个 session 同时只能有一个待确认请求或活跃传输；重复头合并、取消后抑制，不形成弹窗循环。前端重挂载不能自动确认旧请求。
- 不支持 ZCOMMAND 远端命令执行，不根据文件名执行本地或远端命令，不自动打开接收的文件。
- 文件名作为不可信元数据校验；不允许目录穿越、绝对路径、控制字符。下载阶段还要覆盖 Windows 盘符、UNC、设备名、符号链接及重解析点。
- 本地文件访问绑定用户选择授权与 operation ID；记录必要状态即可，不记录文件内容、协议原始帧、凭据或 OTP。

### 4.4 状态、窗口与断线

状态：`idle → detected → awaitingSelection → negotiating → transferring → finishing → completed`；中途可到 `cancelling → cancelled` 或 `failed`。关闭对话框不是状态完成的充分条件，后端必须确认已释放本次操作。

- 操作绑定 `{sessionId, channelGeneration, operationId}`。同一个 session 自动重连拿到新 shell 后，旧回调、文件选择结果及协议响应全部失效。
- 切标签、分屏缩放不影响传输。不同 session 可独立传输；同一 session 第二次请求返回 busy。
- 协议引擎在后端，移至独立窗口不会创建第二个引擎。首版由当前挂载该终端实例的窗口响应提示并展示进度；如果终端被移出窗口，旧窗口不处理该 session 的事件。
- 原生独立窗口关闭时结束其中的会话；关闭窗口或终端标签会取消对应终端传输并释放其 channel。移至其他独立窗口时会话及传输继续。
- 网络中断立即使本次传输失败；终端可以按现有规则重连，但文件传输不自动重放或续传。
- 建议初始超时：选择文件 120 秒，协议协商/无有效进展 30 秒，取消清理 2 秒；这些是待 spike 验证的产品参数，不是 ZMODEM 协议常量。后端在超时后只发一次终态事件。

### 4.5 大文件、覆盖和完成语义

- 本地文件分块读取；先读取元数据并在传输中检查文件变更。首版最多选择 64 个普通文件、单文件小于 4 GiB；协议待处理字节有 1 MiB 上限，进度事件最多约 10 次/秒。
- 空文件、多个文件、二进制文件必须正常工作。首版不承诺 >4 GiB 文件或断点续传，超过已验证上限在发送前明确拒绝，不发生整数截断。
- 首版不默认添加 `rz -y`。远端手动启动的 `rz` 参数决定覆盖/跳过策略；ZMODEM 引擎没有独立的“跳过”事件，UI 根据文件是否实际发送字节提示“远端未请求数据（可能跳过或目标已完整存在）”，并区分协议完成与失败，不能承诺客户端可以强行覆盖服务端策略。
- `sz` 的本地同名文件选择独立于上述远端 `rz` 策略。仅对现有普通文件提供覆盖；符号链接、目录等同名路径安全跳过。若原文件在下载期间发生变化，拒绝替换并保留原文件。
- 发送最后一块不代表成功；至少等待协议确认与正常会话结束。该状态称“协议传输完成”，不等于独立验证了目标资产路径和 SHA-256。
- 真实环境验收由测试者对两端文件做 SHA-256 比对。生产中只有在明确、授权且能绑定目标资产的校验能力存在时，才额外展示“内容已校验”。

## 6. 接口与配置草案

以下为新增契约草案，实施时同步 Rust serde、TS 类型、services、命令注册和主/独立窗口 capability。

```ts
type TerminalTransferState =
  | "detected" | "awaitingSelection" | "negotiating" | "transferring"
  | "finishing" | "cancelling" | "completed" | "cancelled" | "failed";

interface TerminalTransferStatus {
  operationId: string;
  sessionId: string;
  channelGeneration: number;
  revision: number;
  protocol: "zmodem";
  direction: "upload" | "download";
  state: TerminalTransferState;
  fileName?: string;
  fileIndex?: number;
  fileCount?: number;
  transferred: number;
  total?: number;
  requestedDirectory?: string;
  targetVerification: "unknown" | "protocolOnly" | "verified";
  errorCode?: string;
  message?: string;
}
```

建议命令：

- `respond_terminal_transfer`：提交检测 ID、session/generation、文件选择授权或拒绝；后端核验归属和有效期，幂等处理重复响应。
- `cancel_terminal_transfer`：按 operation ID 取消，取消已完成操作返回终态，不再创建请求。
- `list_terminal_transfers`：仅返回所属窗口可展示的元数据快照。
- `inspect_sftp_path`：只读检查路径上下文；不创建测试文件或执行远端 shell。
- 事件 `terminal://transfer-status`：定向发送元数据，含单调 revision；文件字节不走全局 Tauri 事件。

建议错误码：`terminal_transfer_busy`、`terminal_transfer_stale`、`zmodem_cancelled`、`zmodem_timeout`、`zmodem_protocol_error`、`transfer_local_file_changed`、`transfer_connection_lost`、`sftp_path_context_unknown`、`sftp_target_verification_failed`。策略拒绝/远端缺少 `rz` 仅在确有证据时分类，不能将所有超时解释为权限问题。沿用 `AppError` 与前端拒绝归一化。

配置使用 SSH profile 的可选传输选项，SQLite 新增编号迁移，旧记录和旧导入缺省为 `serverFlavor: "auto"`。持久化的根目录说明应按资产上下文区分，不能一个堡垒机 profile 只有一个全局 `/tmp` 映射；首版无法获得稳定资产标识时只保留在当前工作区，不持久化虚构关联。活动终端关联、operation ID、文件选择授权不写入数据库或导出文件。
