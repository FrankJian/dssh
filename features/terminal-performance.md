# 终端吞吐、生命周期与显示保真规格

> 状态：尚未开始，已完成现状审计。本文定义终端数据通路、实例生命周期与渲染保真的优化边界。
> 所有改动必须**先测出基线再动手**，且不得改变现有的 TOFU 主机密钥校验、自动重连语义与终端可读性。

## 1. 现状审计

终端数据通路是：

```
russh ChannelMsg::Data
  └─ decode_with_carry            session_manager.rs:547
     ├─ push_session_output       → Rust 侧 200 KB String 快照
     └─ emit_output               → app_handle.emit("terminal-output")  ← 广播到所有窗口
                                       └─ JSON 序列化 + IPC
                                          └─ useTerminalSessions.pushOutput
                                             ├─ buffersRef  → 前端 20 万字符 String
                                             └─ listener    → terminal.write()
                                                              └─ xterm scrollback 5000 行
```

审计出的具体问题，按影响排序：

| # | 问题 | 位置 | 影响 |
| --- | --- | --- | --- |
| P1 | 每个 SSH 数据包 emit 一次事件，无合并 | `session_manager.rs:544-551` | 高吞吐时每秒数千次 IPC |
| P1 | 切标签 / 切分屏 zoom 会 dispose 并重建终端，重放 backlog | `TerminalWorkspace.tsx:114-131`、`App.tsx:1325-1473`、`TerminalView.tsx:155-165` | 卡顿、滚动位置与选区丢失、alt screen 状态可能错乱 |
| P1 | 前端缓冲用字符串拼接 + `slice` 截断 | `useTerminalSessions.ts:25-31,50-64` | 稳态下每块数据触发一次 20 万字符拷贝 |
| P2 | `emit` 广播到所有窗口；每个窗口缓冲所有会话 | `session_manager.rs:925-933`、`useTerminalSessions.ts:146-149` | 独立窗口数量的倍数放大 |
| P2 | `terminal.write()` 无反压，xterm 写缓冲无界增长 | `TerminalView.tsx:160-162` | 洪水输出时内存与延迟同时飙升 |
| P2 | ANSI 控制字符在 JSON 里被转义成 `\uXXXX`，1 字节变 6 字节 | serde_json 默认行为 | TUI 程序（vim / tmux / htop）负载显著膨胀 |
| P3 | Windows 未设置 xterm 的 `windowsPty` 提示 | `TerminalView.tsx:124-142` | ConPTY 下 resize 折行错乱 |
| P3 | 字符宽度使用默认 Unicode 6 表 | 未安装 `@xterm/addon-unicode11` | CJK / emoji / 制表符宽度与远端不一致 |
| P3 | `scrollback: 5000` 硬编码，且与 Rust 快照、前端缓冲三份并存 | `TerminalView.tsx:136` | 每终端数 MB 量级，多分屏叠加 |
| P3 | 分屏拖拽每个 mousemove 重建全部 layout 并触发 fit | `PaneGrid.tsx:68-77`、`usePaneLayout.ts:172-177` | 一次拖拽上百次缓冲区回流 |
| P3 | 每个 pane 各自创建 WebGL 上下文，丢失后静默降级 | `TerminalView.tsx:361-382` | 逼近浏览器上下文上限时无提示地变慢 |
| P4 | `cursorBlink: true` 不可关，空闲时仍周期重绘 | `TerminalView.tsx:130` | 多终端时阻止真正静默 |
| P4 | 无终端内搜索 | 全仓库无 `@xterm/addon-search` | 功能缺口 |

### 已经正确、不要改坏的部分

- `decode_with_carry`（`session_manager.rs:1044-1073`）正确处理跨包的多字节 UTF-8，改数据通路时必须保持等价语义。
- `ResizeObserver` 已用 rAF 合并（`TerminalView.tsx:309-317`），`fit()` 用 `lastSizeRef` 挡掉行列未变时的 IPC（`TerminalView.tsx:241-247`）。
- 选中色贴近背景是为了规避 WebGL 字形图集的抗锯齿差异（`terminalTheme.ts:13-22`），不得为了“更好看”而提高对比度。
- `allowTransparency` 只在有壁纸或 alpha < 1 时开启（`TerminalView.tsx:69,128`），这条判定不能因为其他特性而放宽。
- `fit()` 中的行高兜底：渲染行高大于容器时回退一行，避免最后一行被 `overflow: hidden` 切半（`TerminalView.tsx:226-235`）。

## 2. 目标与非目标

### 目标

- 把稳态 IPC 事件率降低一到两个数量级，且不增加可感知的输出延迟。
- 终端实例常驻：切标签、切 surface、分屏 zoom 都不再销毁 xterm，滚动位置与选区保留。
- 消除前端缓冲在稳态下的 O(n) 拷贝。
- 为洪水输出建立端到端反压，使内存有界。
- 修正 Windows ConPTY 与字符宽度带来的显示失真。
- 建立可复现的性能基线与回归门槛。

### 非目标

- 不改变 SSH 连接池、主机密钥 TOFU、重连退避与 channel 归属模型。
- 不改造 AI 的 `read_terminal` 语义（它依赖 Rust 侧快照，快照结构变更必须保持该命令的行为）。
- 不引入新的终端渲染器，也不替换 xterm。
- 不把终端搜索、录制、序列化等新功能塞进本规格；它们各自独立评估。

## 3. 性能基线与指标

**先测，后改。** 每个阶段前后都用同一套方法复测，数据记入本节。

| 指标 | 测量方法 | 门槛 |
| --- | --- | --- |
| 吞吐 | 远端 `cat` 一个 50 MB 文本文件，记录墙钟时间 | 与同机 Windows Terminal / iTerm2 的差距记录在案，改造后不得回退 |
| IPC 事件率 | Rust 侧计数器，统计每秒 emit 次数并在 debug 构建下输出 | 合并后稳态 < 250 次/秒 |
| 输出延迟 | 单行 `echo` 从发出到上屏，高帧率录屏计帧 | 合并策略不得使其超过 1 帧额外延迟 |
| 输入延迟 | 按键到回显，高帧率录屏计帧 | < 2 帧 |
| 帧率与长任务 | DevTools Performance，录制滚动与 `htop` 场景 | 无 > 50 ms 长任务 |
| 切标签耗时 | `performance.mark` 包住 TerminalView 挂载到首帧 | 常驻化后接近 0 |
| 常驻内存 | 单终端、四格分屏、两个独立窗口三档下的堆占用 | 记录基线，防回归 |
| 拖拽开销 | 一次分屏拖拽内 `terminal.resize()` 的调用次数 | 从上百降到个位数 |

测量脚本与结果表放在 `docs/` 或本文附录，必须可被他人复现，不接入 CI。

### 3.1 IPC 事件率的复现步骤

`src-tauri/src/ssh/session_manager.rs` 的 `output_metrics` 模块只在 debug 构建里编译，每秒把过去一秒的
emit 次数、字节数与平均事件大小打到 stderr。步骤：

1. `pnpm tauri dev`，观察运行 `pnpm tauri dev` 的终端（不是应用内的终端）。
2. 连上目标主机，在应用内跑一个持续刷屏的命令，例如 `cat /var/log/…` 或 `yes | head -c 50000000`。
3. 记录稳态下的 `[terminal-output] N events/s, M bytes/s, K bytes/event`。

判读方式：`events/s` 是每秒跨进程投递的次数，`bytes/event` 是合并效果。合并前每个 SSH 包一次事件，
`bytes/event` 会停在单包大小上；合并后应稳定在 4 ms 窗口能攒下的量级，`events/s` 落到 250 以内。

要拿到合并前的对照，把 `OutputSink::push` 里的窗口判断临时改成恒真（或把 `OUTPUT_FLUSH_INTERVAL`
设为 0）再跑一遍同样的命令。

### 3.2 拖拽开销的复现步骤

在 `TerminalView` 的 `fit()` 里临时加一个计数器打印，然后把窗口分成四格，拖动一次分隔条到底再松手，
读计数。合并前每帧每格各一次，合并后一次拖拽应只在 mouseup 后触发每格一次。

## 4. 分层方案

### 4.1 输出合并（Rust 侧）

在读循环与 `emit_output` 之间加一层合并器：

- 累积策略：**攒够 16 KB 或距上次 flush 超过 4 ms 就 flush**，两者取先到者。空闲时立即 flush，保证交互式单行输出不被人为延迟。
- 合并必须发生在 `decode_with_carry` 之后、`push_session_output` 与 `emit_output` 之前，保持快照与事件内容一致。
- 会话关闭、状态变更（`emit_status`）前必须强制 flush，避免输出与状态消息乱序。
- 本地 PTY 路径（`run_local_session`，`session_manager.rs:631-647`）复用同一合并器。

这一步不改协议、不改前端，是收益最高、风险最低的改动，必须最先做。

### 4.2 定向投递

- 后端维护 `session_id → 订阅窗口 label` 的表，由前端在挂载 / 卸载终端时通过命令注册与注销。
- `emit_output` 改用 `emit_to` / `emit_filter`，只发给订阅方。
- 主窗口与 `detached-*` 使用同一套注册路径；窗口关闭时必须清理订阅，不能泄漏。
- 前端相应地只缓冲本窗口订阅的会话。

### 4.3 前端缓冲结构

- `buffersRef` 从单个 String 改为 chunk 数组（或环形缓冲），追加 O(1)，只在 `getBacklog` 时 join。
- 截断按 chunk 粒度丢弃，**不得在字符中间或 ANSI 转义序列中间切断**。
- 缓冲上限与 Rust 快照上限统一为同一个常量概念，避免三处各有一套。

### 4.4 反压（暂缓，前提不成立）

原方案：`terminal.write(data, callback)` 记录未确认字节数，超过高水位时通知后端暂停从 channel 读取，
低于低水位恢复；且暂停只能作用于该会话的 channel，不得阻塞同一 transport 上的 SFTP、转发与 host tools。

**核查 russh 0.62.1 后确认这个前提不成立，本节暂缓实施：**

- 会话循环对 channel 的投递是 `chan.send(...).await`（`client/encrypted.rs:470`），底层是容量 100 的
  bounded mpsc。russh 自己的文档把它描述为“在把反压传导到 TCP 流之前能存的未处理消息数”。
  一旦我们停止消费某个 channel，缓冲填满后阻塞的是整个 session loop，同一 transport 上的所有 channel
  一起停摆——正是 T2.4 明令禁止的结果。
- SSH 窗口信用在**收到**数据时就已补发（`client/encrypted.rs:460` 的 `adjust_window_size`），与我们是否
  消费无关。所以协议层的 per-channel 流控在 russh 这里不会替我们生效。

可选出路，都有明显代价，需要单独定夺后再做：给终端 channel 单开一条 transport（放弃连接复用、额外一次
认证、与连接池的所有权模型冲突）；或改为在 Rust 侧丢弃输出（终端字节流不能随意丢，会破坏解析状态与屏幕
内容）；或向上游争取按消费驱动的窗口调整。

在此之前，洪水场景的实际护栏是 4.1 的合并（事件率有界）与 4.3 的保留输出量上限（内存有界）。

### 4.5 原始字节通道（条件执行）

仅在 4.1–4.4 完成并复测后，若 IPC 仍是瓶颈才做：

- 用 `tauri::ipc::Channel` 以 `InvokeResponseBody::Raw` 传字节，前端收 `ArrayBuffer` 并用增量 `TextDecoder` 解码。
- 采用后 `decode_with_carry` 的职责移到前端，Rust 侧快照仍需保留可读文本供 AI `read_terminal` 使用。
- 该改动横跨命令注册、事件模型与前端服务层，必须有独立的回归测试与回退开关。

### 4.6 终端实例常驻

- 由一个 session → `Terminal` 的注册表持有实例，`TerminalView` 只负责把已有实例挂到当前 DOM 容器上。
- 切标签、切 surface、分屏 zoom、进出 Zen 只做挂载点搬迁或可见性切换，不 dispose。
- 真正销毁只发生在会话关闭、窗口关闭与分离 / 回归工作区时。
- 常驻后 backlog 重放只在窗口冷启动时发生；届时 backlog 必须来自后端 `read_ssh_session_output` 的完整快照，不能是被字符下标硬切过的字符串。
- 注册表必须与 `DetachedWorkspaceManager` 的分离 / 回归路径协同，会话 ID 不变、pane 树整体迁移的既有语义不能破坏。

### 4.7 显示保真

- Windows 上给 `new Terminal` 传 `windowsPty: { backend: "conpty", buildNumber }`，修正 ConPTY 的换行与重排语义。仅对本地终端会话生效，SSH 会话不受影响。
- 评估引入 `@xterm/addon-unicode11` 并切到 Unicode 11 宽度表；需先确认它是否要求放开 `allowProposedApi`（当前为 `false`），以及放开后的 API 面风险。
- `scrollback` 做成设置项，并与前端缓冲、Rust 快照的上限一起在设置里表述为一个“保留输出量”概念。
- `cursorBlink` 做成设置项。
- WebGL 上下文丢失后给出可见状态提示，并记录当前渲染后端（GPU / DOM），便于用户与排障时判断。

### 4.8 Resize 路径

- 分屏拖拽的 `mousemove` 用 rAF 节流。
- `setRatios` 只重建被拖动的那棵 layout 树，不 `map` 全部 layout。
- 拖拽期间挂“暂停 fit”标记，`mouseup` 后统一 fit 一次。

## 5. 实施阶段

1. **Phase 0 基线**：建立第 3 节全部指标的测量方法与基线数据。
2. **Phase 1 输出合并**：Rust 侧合并器（SSH + 本地 PTY），复测吞吐与延迟。
3. **Phase 2 前端缓冲与反压**：chunk 缓冲、端到端反压。
4. **Phase 3 终端常驻**：实例注册表、挂载点搬迁、backlog 来源修正。
5. **Phase 4 定向投递**：订阅表、`emit_to`、独立窗口去重。
6. **Phase 5 显示保真**：`windowsPty`、Unicode 宽度、scrollback / cursorBlink 设置项、渲染后端提示。
7. **Phase 6 Resize 路径**：拖拽节流与局部 layout 更新。
8. **Phase 7（条件）原始字节通道**：仅在前六阶段复测后 IPC 仍为瓶颈时执行。

阶段间可以独立发布；Phase 3 依赖 Phase 2 的缓冲结构，Phase 4 依赖 Phase 3 的挂载生命周期。分阶段任务清单见 [`tasks.md`](../tasks.md#终端吞吐生命周期与显示保真)。

## 6. 验收标准

- 第 3 节全部指标在改造后均不低于基线，且合并、常驻、拖拽三项达到各自门槛。
- 切标签往返后滚动位置、选区、alt screen 程序（vim / htop / less）画面完全保持。
- 洪水输出（`yes`、`cat` 大文件）期间内存有界，界面保持可交互，Ctrl-C 能及时生效。
- 独立窗口与主窗口之间分离、回归、关闭后无会话泄漏、无重复缓冲、无订阅残留。
- macOS 与 Windows 的**打包产物**上各跑一遍完整场景，含中文输入法、CJK 宽字符、多显示器 DPI 切换。
- `pnpm exec tsc --noEmit`、`pnpm build` 通过；Rust 改动后 `cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test` 通过。

## 7. 决策记录

- **先合并再谈换通道**：合并是纯后端、零协议改动的优化，多数情况下已足够；原始字节通道横跨三层，只在数据证明必要时才付出这个复杂度。
- **常驻实例优先于优化重放**：重放路径同时是性能问题和正确性问题（截断的流无法还原 alt screen 状态）。与其把重放做快，不如让它基本不发生。
- **反压放在缓冲改造之后**：反压需要一个能准确统计未确认字节的写入路径，先把缓冲结构理顺再接反压，否则两处状态容易不一致。
- **反压暂缓，不牺牲连接复用**：russh 的 per-channel 暂停会经 bounded mpsc 把反压传到 TCP，连累同一 transport 上的
  SFTP 与转发（详见 4.4）。在“终端不卡”和“SFTP 不卡”之间，不接受用后者换前者；宁可让洪水场景先由合并与保留量上限兜底，
  也不引入一个会让整条连接停摆的机制。
- **不动选中色与透明判定**：这两处都有明确的既有理由（WebGL 字形图集、透明渲染开销），性能改造不得顺手改掉。
