# Duo SSH 实施任务

> 本文件记录已经完成规格评审、可以按阶段实施的任务。高层优先级与其他未排期事项见
> [`TODO.md`](TODO.md)，当前界面约定见 [`spec.md`](spec.md)。完成的任务应及时删除或压缩为简短记录，
> 避免与仍需实施的步骤混杂。

## 终端吞吐、生命周期与显示保真

> 状态：Phase 1、Phase 3、Phase 6 已落地，Phase 0 的工具与 Phase 2 的缓冲改造已落地，Phase 5 只做了 ConPTY 一项；
> Phase 2 的反压经核查前提不成立，已暂缓（见下）。
> 实施严格遵循 [终端性能规格](features/terminal-performance.md) 的 Phase 0 → 1 → 2 → 3 → 4 → 5 → 6；
> Phase 7 为条件执行，只在前六阶段复测后 IPC 仍为瓶颈时才做。**Phase 0 的基线数据是所有后续阶段的验收依据，不得跳过。**
>
> 已勾选的是代码改动，凡是“复测/验证”类的条目仍未勾选：需要在真实主机上跑一遍才能确认门槛达标。

### Phase 0：性能基线

- [x] **T0.1 测量方法**：为规格第 3 节的八项指标各写一个可复现的手工步骤（吞吐、IPC 事件率、输出延迟、输入延迟、帧率与长任务、切标签耗时、常驻内存、拖拽 resize 次数），固定测试主机、文件大小、窗口尺寸与字号，避免不同次测量不可比。
- [x] **T0.2 后端计数器**：在 debug 构建下为 `emit_output` 增加每秒事件数与字节数统计，作为合并前后的直接对照，不得进入 release 构建的常规日志。
- [ ] **T0.3 基线数据**：在 macOS 与 Windows 各采集一遍全部指标，含单终端 / 四格分屏 / 两个独立窗口三档，结果写回规格第 3 节。
- [ ] **T0.4 对照组**：在同一台机器上用 Windows Terminal 或 iTerm2 跑同样的吞吐用例，记录差距量级，避免把平台固有开销误判为本项目的问题。

**Phase 0 验收**：任何人按文档能复现同一组数字；后续每个阶段都有明确的对照基线。

### Phase 1：输出合并

- [x] **T1.1 合并器**：在 `decode_with_carry` 之后、`push_session_output` / `emit_output` 之前插入合并层，策略为“攒够 16 KB 或距上次 flush 超过 4 ms 即 flush”，空闲时立即 flush，保证交互式单行输出不被人为延迟。
- [x] **T1.2 顺序保证**：会话关闭、状态变更（`emit_status`）与重连提示前强制 flush，确保输出与状态消息不乱序；`push_session_output` 的快照内容必须与实际 emit 的内容一致。
- [x] **T1.3 本地 PTY 复用**：`run_local_session` 的读线程复用同一合并器，不要写第二套实现。
- [ ] **T1.4 复测**：复测吞吐、IPC 事件率与输出延迟，确认事件率降到 < 250 次/秒且输出延迟未增加超过 1 帧。

**Phase 1 验收**：事件率达标、吞吐提升、交互式输入的回显手感无变化；无输出丢失、无顺序错乱。

### Phase 2：前端缓冲与反压

- [x] **T2.1 chunk 缓冲**：`buffersRef` 由字符串拼接改为 chunk 数组或环形缓冲，追加 O(1)，仅在 `getBacklog` 时 join；截断按 chunk 粒度丢弃，不得在字符或 ANSI 转义序列中间切断。
- [x] **T2.2 上限统一**：把前端缓冲上限与 Rust 侧 `MAX_SESSION_BUFFER_BYTES` 统一为一个“保留输出量”概念，消除两处各自为政的常量。
- [~] **T2.3 写入反压**：**暂缓**。经核查 russh 0.62.1，暂停消费某个 channel 会经容量 100 的 bounded mpsc 把反压传导到 TCP 流，阻塞整个 session loop；且 SSH 窗口信用在收到数据时即补发，与消费无关。见规格 4.4。
- [~] **T2.4 反压边界**：**暂缓**，原因同上——T2.4 要求的“只影响本会话 channel”在当前 russh 下做不到，实施它就等于让同一 transport 上的 SFTP 与端口转发一起停摆。
- [ ] **T2.5 洪水回归**：跑 `yes`、`cat` 超大文件与 `find /` 三个用例，确认内存有界、界面可交互、Ctrl-C 及时生效。（反压暂缓后，护栏是 T1.1 的合并与 T2.2 的保留输出量上限，这条回归仍要跑。）

**Phase 2 验收**：稳态下无 20 万字符级拷贝；洪水输出期间内存不再无界增长且终端仍可中断。（反压部分见上方暂缓说明。）

### Phase 3：终端实例常驻

- [x] **T3.1 实例注册表**：新增 session → `Terminal` 的注册表持有 xterm 实例与其 addon，`TerminalView` 改为只负责把已有实例挂载到当前 DOM 容器。
- [x] **T3.2 挂载点搬迁**：切标签、切 surface（SFTP / S3 / 连接管理）、分屏 zoom、进出 Zen 全部改为搬迁挂载点或切换可见性，不调用 `dispose()`；确认滚动位置与选区保留。
- [x] **T3.3 销毁时机**：只在会话关闭、窗口关闭与工作区分离 / 回归时销毁实例；补齐 addon、监听器与 WebGL 上下文的释放，避免泄漏。
- [ ] **T3.4 backlog 来源**：冷启动重放改用后端 `read_ssh_session_output` 的完整快照，不再使用按字符下标硬切的前端字符串，消除截断转义序列导致的画面错乱。
- [ ] **T3.5 独立窗口协同**：与 `DetachedWorkspaceManager` 的分离 / 回归路径对齐，保持会话 ID 不变、pane 树整体迁移的既有语义；完整重启 Tauri 后验证。
      *代码侧已处理：注册表按窗口独立（DOM 节点无法跨窗口搬迁），分离时父窗口显式 `releaseTerminal`，回归时按 backlog 重建；仍需真机验证。*
- [ ] **T3.6 交互回归**：切标签往返后 vim / htop / less 画面完全保持；`performance.mark` 复测切标签耗时。

**Phase 3 验收**：切换不再重建终端，滚动位置、选区与全屏程序画面均保持；切标签耗时接近 0。

### Phase 4：定向投递

- [ ] **T4.1 订阅表**：后端维护 `session_id → 订阅窗口 label`，前端在终端挂载 / 卸载时经命令注册与注销；主窗口与 `detached-*` 共用同一路径。
- [ ] **T4.2 定向 emit**：`emit_output` 改用 `emit_to` / `emit_filter`，只发给订阅方；窗口关闭时清理订阅，不得泄漏。
- [ ] **T4.3 按需缓冲**：前端只缓冲本窗口订阅的会话，消除多窗口下的重复缓冲。
- [ ] **T4.4 复测**：在两个独立窗口 + 多会话场景下复测 IPC 事件率与常驻内存，确认不再随窗口数线性放大。

**Phase 4 验收**：窗口只收到自己显示的会话数据；多窗口下的事件率与内存不再倍数增长。

### Phase 5：显示保真

- [ ] **T5.1 Windows ConPTY**：为本地终端会话传 `windowsPty: { backend: "conpty", buildNumber }`，验证 resize 时的折行与重排恢复正常；SSH 会话不受影响。
      *已传 `{ backend: "conpty" }`（仅本地会话、仅 Windows）。`buildNumber` 取不到，留空即关闭旧版 ConPTY 的兼容启发式，对 Win10 21376 之前的版本是否需要补值待验证；折行行为本身也仍需在真机上确认。*
- [ ] **T5.2 字符宽度**：评估引入 `@xterm/addon-unicode11` 并切到 Unicode 11 宽度表；先确认是否需要放开 `allowProposedApi`（当前 `false`）及其 API 面风险，再决定是否采纳。用 `htop` / `tmux` / CJK 与 emoji 混排验证边框对齐。
- [ ] **T5.3 保留输出量设置项**：把 `scrollback` 做成设置项，与前端缓冲、Rust 快照上限在设置里表述为一个概念，并说明其内存代价。
- [ ] **T5.4 光标闪烁设置项**：`cursorBlink` 做成设置项，评估默认值；关闭后确认空闲终端不再周期重绘。
- [ ] **T5.5 渲染后端可见性**：WebGL 上下文丢失或创建失败时给出可见提示并暴露当前渲染后端（GPU / DOM）；核对四格分屏 + 多独立窗口下是否逼近浏览器上下文上限。

**Phase 5 验收**：Windows 本地终端 resize 无折行错乱；CJK / emoji / 制表符宽度与远端一致；渲染降级用户可见。

### Phase 6：Resize 路径

- [x] **T6.1 拖拽节流**：分屏拖拽的 `mousemove` 用 rAF 节流，避免每个事件都进 React 状态更新。
- [x] **T6.2 局部更新**：`setRatios` 只重建被拖动的那棵 layout 树，不再 `map` 全部 layout。
- [x] **T6.3 延迟 fit**：拖拽期间挂“暂停 fit”标记，`mouseup` 后统一 fit 一次；复测一次拖拽内 `terminal.resize()` 的调用次数降到个位数。

**Phase 6 验收**：四格分屏拖拽全程流畅，缓冲区回流次数达标，松手后行列与后端 PTY 尺寸正确同步。

### Phase 7：原始字节通道（条件执行）

- [ ] **T7.1 判定**：依据 Phase 1–6 复测数据判断 IPC 是否仍是瓶颈；不是则明确记录“不执行”并关闭本阶段。
- [ ] **T7.2 通道实现**：用 `tauri::ipc::Channel` 以 `InvokeResponseBody::Raw` 传字节，前端收 `ArrayBuffer` 并以增量 `TextDecoder` 解码；Rust 侧仍保留可读文本快照供 AI `read_terminal` 使用。
- [ ] **T7.3 回退开关与测试**：提供可回退到事件通道的开关，补齐跨包多字节 UTF-8、超大块、快速连断的回归测试，确认与 `decode_with_carry` 语义等价。

**Phase 7 验收**：吞吐相对 Phase 6 有可测量的提升，且 CJK 与 ANSI 密集场景无解码错误；否则回退并保留事件通道。

## 原生窗口材质（桌面透视）

> 状态：待实现的可选增强。默认 Graphite Glass 的 token、应用内 chrome / 浮层材质、fallback 与终端协同已在 [`features/graphite-glass-theme.md`](features/graphite-glass-theme.md) 实现；这里仅保留 Tauri 原生窗口材质。实施严格遵循 [液态玻璃规格](features/liquid-glass.md) 的 Phase 0 → 1 → 2 → 3 → 4 → 5；Phase 6 为可选增强，不属于发布门槛。原生材质默认关闭；后续窗口实现必须先通过 Phase 0 的窗口行为验证。

### Phase 0：可行性与基线

- [ ] **G0.1 透明窗口行为 spike**：在临时分支给主窗口加 `transparent: true`，在 Windows 11 与 macOS 上逐项实测边缘拖拽缩放、贴边分屏、双击标题栏最大化、最小化 / 恢复、任务栏与 Dock 预览、多显示器 DPI 切换。任一项破坏且无可接受缓解时，`window` 模式退回“切换需重启”或直接不发布。
- [ ] **G0.2 启动闪烁与显示时机**：验证 `transparent: true` 在 Windows 打包产物上的首帧闪白程度；如需缓解，设计 `visible: false` 创建 + 前端首帧后调用命令显示的流程，并确认它不影响 updater、深链接与独立窗口。
- [ ] **G0.3 材质可用性探测**：确定 Windows build 号 / DWM 合成状态、macOS 版本的探测方式与判定阈值（Win11 22000 起支持 Mica；Win10 判定为不支持），产出 `WindowMaterialSupport` 的字段定义与不支持原因文案。
- [ ] **G0.4 性能基线**：在开启材质前记录基线：终端 `cat` 大文件的帧率与 CPU、窗口拖动 / 缩放平滑度、常驻内存。分别记录 Mica、Acrylic、macOS vibrancy 三种材质开启后的同一组数据，确认 Acrylic 的拖拽 / 缩放掉帧程度是否需要在 UI 上标注或直接不提供。
- [ ] **G0.5 WebView 能力核对**：确认 WebView2 与 WKWebView 对 `backdrop-filter`、`@supports not (backdrop-filter: ...)`、`prefers-reduced-transparency` 的实际支持情况，以及嵌套磨砂层的渲染代价，据此锁定第 5.2 节的两层上限。

**Phase 0 验收**：三种材质在两个平台各有一组可比的性能与窗口行为记录；“免重启切换”是否可行有明确结论。结论为否时更新规格再进入 Phase 3，但不阻塞 Phase 1、2。

### Phase 1：原生材质偏好模型（不重做 CSS 玻璃）

- [x] **G1.1 Graphite 基线**：`--bg-base` / `--bg-raised` 已映射到语义 surface token；`--glass-*`、`.is-glass-chrome` / `.is-glass-overlay`、实色 fallback 与减少透明度覆盖均由 Graphite Glass 实现。人工视觉验收仍待统一执行。
- [ ] **G1.2 原生材质状态**：新增仅用于桌面透视的 `data-window-material="off|window"` 和偏好解析；不得新增 `overlay` 模式、`data-material` 或第二套 CSS 磨砂类。
- [ ] **G1.3 原生材质 token 覆盖**：只在 `data-window-material="window"` 下调整窗口底板透明度，复用已有 `--glass-*` 与表面 token；不改变终端、编辑器或文件列表背景。
- [ ] **G1.4 降级路径**：原生材质不支持时回退到 `off`；Graphite Glass 的 `@supports` / 减少透明度 fallback 继续独立生效。
- [ ] **G1.5 对比度校准**：在真实桌面亮 / 暗背景、深浅主题下测量原生材质合成后的正文、次级文字与图标，最终值回写规格。

**Phase 1 验收**：原生偏好不会改写默认 Graphite Glass 表面；不支持的环境稳定退回默认主题。

### Phase 2：设置项与状态管理

- [ ] **G2.1 设置常量**：在 `src/settings/settings.ts` 增加 `appearanceGlassModeKey` / `appearanceGlassIntensityKey`、`GlassMode`（仅 `off | window`）/ `GlassIntensity` 类型、默认值与解析函数，沿用现有 `parseBoolean` 一类的容错风格。
- [ ] **G2.2 `useGlassSettings`**：新增 hook 管理模式与强度，写 localStorage，写 `document.documentElement.dataset.windowMaterial` / `dataset.windowMaterialIntensity`，并**照抄 `useTheme` 的 `storage` 事件监听**实现跨窗口同步（现有 `useTerminalSettings` 没有这一层，不要以它为模板）。
- [ ] **G2.3 外观设置 UI**：在 `SettingsDialog.tsx` 的 `“appearance“` 分类中，主题之后新增“原生窗口材质”区块：关闭 / 整窗两档（沿用 `.settings-theme__option` 的分段按钮样式）+ 可选强度；不支持的选项禁用并给出原因。不得提供关闭默认 Graphite Glass 的选项。
- [ ] **G2.4 接线主窗口与独立窗口**：在 `App.tsx` 与 `DetachedWorkspace.tsx` 各接入 hook；确认独立窗口在无设置面板的情况下也能通过 `storage` 同步实时更新。
- [ ] **G2.5 文案更新**：把“窗口对桌面的整体透明需要系统级窗口透明，暂未开启”改为说明“Graphite Glass 默认只作用于应用内 chrome / 浮层；整窗桌面透视需要系统级窗口透明”。

**Phase 2 验收**：设置里切换模式与强度立即生效并持久化；重开应用与打开独立窗口都保持一致；`off` 状态保留默认 Graphite Glass。

### Phase 3：窗口材质（`window` 模式）

- [ ] **G3.1 Tauri 窗口配置**：`tauri.conf.json` 与 `tauri.macos.conf.json` 主窗口均加 `transparent: true`；macOS 追加 `app.macOSPrivateApi: true` 并给 `tauri` crate 开 `macos-private-api` feature。在 README / 规格中记录其对 Mac App Store 分发的影响。
- [ ] **G3.2 Rust 命令与 DTO**：新增 `window_material_support` 与 `apply_window_material` 命令、`models/` 下的 camelCase DTO，注册进 `lib.rs`；实现 Windows（Mica / MicaDark / MicaLight，显式选择时 Acrylic）与 macOS（`UnderWindowBackground` + `FollowsWindowActiveState`）的材质施加与清除，错误按 `AppError` 约定返回。
- [ ] **G3.3 前端服务层**：新增 `src/services/windowMaterialService.ts`，经 `invokeCommand` 规范化错误；应用启动时探测一次能力并缓存，供设置 UI 的禁用态使用。
- [ ] **G3.4 独立窗口一致性**：`workspace/mod.rs` 的 `WebviewWindowBuilder` 同步加 `transparent`，窗口创建后按当前偏好施加材质；确认 `detached-*` 全部覆盖。若最终改走前端 `setEffects`，则 `capabilities/default.json` 与 `capabilities/detached-workspace.json` 都要加 `core:window:allow-set-effects`，并**完整重启 Tauri** 验证（HMR 不重载 capability）。
- [ ] **G3.5 主题联动**：`data-theme` 变化时重新施加材质（Windows 的 Mica 变体、macOS 的 appearance），包含跟随系统主题的自动切换路径。
- [ ] **G3.6 窗口几何**：最大化 / 全屏时把 `.app-shell` 的 6px 圆角改为直角，避免四角漏出桌面；同时核对 Zen 模式与独立窗口。
- [ ] **G3.7 首帧显示流程**：若 G0.2 判定需要，实现 `visible: false` 创建 + 前端首帧后显示，并确认对启动耗时、updater 与独立窗口无副作用。

**Phase 3 验收**：Windows 11 与 macOS 上 `window` 档真实透出桌面并可免重启切换；Windows 10 与不支持环境自动降级；主窗口与独立窗口一致；窗口缩放、分屏、最大化、多显示器行为与改动前无差异。

### Phase 4：终端与内容协同

- [ ] **G4.1 合成顺序核对**：逐档核对“系统材质 → `.app-shell` → `--terminal-surface` → xterm 画布”的实际叠加结果，确保不会叠成糊色；必要时限制终端不透明度与玻璃强度的组合。
- [ ] **G4.2 保持终端透明路径不变**：确认 `TerminalView.tsx` 的 `allowTransparency` 判定仍只由壁纸与 `backgroundAlpha` 决定，玻璃开启不得强制终端走 WebGL 透明渲染。
- [ ] **G4.3 内容区豁免**：确认终端画布、Monaco 编辑器正文、SFTP / S3 / 远端文件树列表均未被磨砂波及，滚动性能无回退。
- [ ] **G4.4 终端选中态复核**：按 `terminalTheme.ts:13-22` 的既有理由，目视确认玻璃开启后选中文字仍清晰可辨，必要时只调整选中色而不改渲染路径。
- [ ] **G4.5 工作区回归**：Zen 模式、分屏（最多四格）、标签拖拽重排、独立窗口分离与回归、命令面板、右键菜单、Toast 在原生材质关闭 / 整窗两档下逐一目视回归。

**Phase 4 验收**：终端默认不透明度下渲染与 `off` 状态一致；开启玻璃后所有工作区形态无视觉错位、无可读性下降、无滚动掉帧。

### Phase 5：验收、性能与发布

- [ ] **G5.1 性能矩阵**：按 G0.4 的方法复测 `off` / `window`×三档强度的终端吞吐帧率、CPU、内存与窗口拖拽缩放表现，记录进规格；回退超出可接受范围的组合需调低默认强度或移除该档。
- [ ] **G5.2 可访问性审计**：完成对比度审计与键盘导航、焦点环、禁用 / 错误 / 破坏性状态在磨砂背景上的可辨性检查；验证 `prefers-reduced-transparency` 在两个平台真实生效。
- [ ] **G5.3 跨平台人工验收**：在 Windows 11、Windows 10、macOS 的**打包产物**（不只是 `tauri dev`）上验证原生材质关闭 / 整窗、深浅主题、跟随系统主题、独立窗口、中文输入法与多显示器。
- [ ] **G5.4 文档更新**：更新 `README.md` 的功能说明、`spec.md` 的界面约定与已规划功能列表，并把本节完成项压缩为简短记录。
- [ ] **G5.5 全套验证**：`pnpm exec tsc --noEmit`、`pnpm build`、`cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test` 全部通过。

**Phase 5 验收**：原生材质关闭时保留默认 Graphite Glass；开启后在两个平台的打包产物上表现稳定、可读、可回退。

### Phase 6：可选增强，不进入发布门槛

- [ ] **G6.1 macOS 26 原生 Liquid Glass 评审**：评估经 `NSGlassEffectView` 私有 API（如 `tauri-plugin-liquid-glass`）获得原生 Liquid Glass 的收益与风险，包括系统小版本失效兜底、崩溃隔离、许可证与分发影响。未通过评审不进入实现。
- [ ] **G6.2 分区材质**：评估侧栏使用 `Sidebar`、浮层使用 `Popover` / `Menu` 等分区材质，使 macOS 观感更贴近原生；仅在不增加窗口层级复杂度时采纳。
- [ ] **G6.3 Windows Acrylic 体验开关**：若 G0.4 显示 Acrylic 代价可接受，则作为显式标注性能代价的高级选项开放；否则保持不提供。

## VNC 远程桌面工作区

> 状态：尚未开始。实施严格遵循 [VNC 远程桌面工作区规格](features/vnc-workspace.md) 的 Phase 0 → 1 → 2 → 3 → 4；Phase 5 为可选增强，不属于首版发布门槛。VNC 不能作为 SSH profile 的字段扩展，且不能把已保存 VNC 密码下发给 WebView。

### Phase 0：协议、桥接与安全门禁

- [ ] **V0.1 RFB / noVNC 兼容性 spike**：锁定候选 @novnc/novnc 版本与 MPL-2.0 合规方式，在 Tauri macOS / Windows WebView 创建最小 RFB renderer；核对 noVNC 的 WebSocket、resize、clipboard、view-only、键盘和卸载 API，记录最小浏览器 / WebView 版本与打包体积变化。
- [ ] **V0.2 Rust RFB 握手 spike**：针对受控 TigerVNC / QEMU fixture 实现或审计 RFB 3.3 / 3.7 / 3.8 版本协商、None、经典 VNC Authentication、ClientInit / ServerInit、错误 reason、取消和读取长度限制；用字节级 golden test 覆盖部分读写与畸形报文。不得以长期无人维护 crate 作为未经审计的唯一安全边界。
- [ ] **V0.3 本地 RFB bridge spike**：验证 Rust 在远端认证完成后，可向 noVNC 暴露仅本次会话的本地 None RFB 握手并透明 relay 已建立流量；证明 noVNC 不需要取得远端密码，desktop 初始化、SetPixelFormat、SetEncodings、输入和 framebuffer update 均能正常工作。
- [ ] **V0.4 回环 capability 安全 spike**：实现临时 127.0.0.1 / ::1 listener、密码学随机且一次性的 capability、受控 Origin、连接 / 握手超时、单 renderer 限制和关闭清理；覆盖 token 重放、错误 Origin、第二客户端、超时与日志脱敏。不得暴露通用 LAN WebSocket-to-TCP proxy。
- [ ] **V0.5 SSH tunnel spike**：为 SSH connection pool 增加 Vnc channel owner，验证从已认证 transport 打开 direct-tcpip 到网关视角的 VNC target；覆盖并发终端 + SFTP + VNC、target 不可达、host-key 提示 / 变更、channel 限额与关闭 VNC 后仅释放其 lease。
- [ ] **V0.6 凭据与许可证门禁**：先完成或最小接入系统 SecretStore，使 VNC password 不会落入普通 SQLite；定义清除、引用计数、导入导出和 zeroize 规则。完成 noVNC 及新增 Rust 依赖的许可证、供应链、跨平台构建和 NOTICE 审查。

**Phase 0 验收**：在 macOS 和 Windows 各连接一个受控 VNC server，画面和输入正常，保存密码没有进入前端 / SQLite / 日志；经 SSH 隧道能与现有 terminal / SFTP 并存；关闭 renderer / 标签会收回 listener、capability 与 channel。任一项不成立时，不进入正式 profile 或凭据保存开发。

### Phase 1：安全的连接模型与 VNC MVP

- [ ] **V1.1 独立 VNC profile 与迁移**：新增 vnc_profiles migration、Rust / TypeScript DTO、独立 repository 和 CRUD；字段覆盖名称、SSH tunnel 或 direct TCP、target host / port、None 或 VNC password、shared、默认只读、收藏、标签和描述。保留现有数据库和 SSH profile 兼容性。
- [ ] **V1.2 SecretStore、删除与配置文件**：实现 VNC password 的创建、更新保持、显式清除和删除清理；普通 YAML 预览遮罩、加密导出 / 导入含 VNC profile，并升级 document version 而不破坏旧格式。安全存储不可用时拒绝保存密码，不回退到明文表。
- [ ] **V1.3 VncManager 与传输**：新增进程内 session registry、direct TCP 与 SSH direct-tcpip transport、RFB handshake、短时 bridge、状态事件、连接 / 读写超时、取消与确定性资源释放。direct TCP 仅作为显式确认后的受限模式：禁用自动重连和默认剪贴板同步。
- [ ] **V1.4 命令与服务层**：注册 list / create / update / delete / favorite / test VNC profile，以及 start / close / reconnect / list VNC session 命令；所有载荷 camelCase，经 invokeCommand 规范化 AppError。start 只返回不可持久化 renderer descriptor，前端不拼接 token 或读取 secret。
- [ ] **V1.5 连接管理接入**：在 connectionTypes、SessionManager、新建菜单、类型筛选、搜索、最近、收藏和卡片中接入 VNC；增加 VncProfileEditor，清晰区分直连与“通过 SSH profile”目标，测试连接仅显示非敏感 RFB 摘要。
- [ ] **V1.6 VNC 标签工作区**：新增 useVncSessions、VncWorkspace、VNC 服务层和 monitor tab kind；以 noVNC 挂载 renderer，支持连接、断开、手动重连、状态 / 错误空态和适配窗口缩放。VNC 不进入 PaneGrid，终端 split 操作在 VNC 标签激活时不可用。

**Phase 1 验收**：可保存并编辑 SSH tunnel VNC profile；以 None 和 VNC password 各连接一个受控服务器，打开两个 VNC 标签，与 SSH terminal / SFTP 同时运行；关闭任何 VNC 标签不影响 SSH transport 上其他 channel；直接 TCP 的风险确认、错误提示和无密码泄露均可验证。

### Phase 2：日常交互与工作区一致性

- [ ] **V2.1 视图与输入控制**：实现适合窗口 / 100% 缩放、裁剪、全屏、重新捕获键盘、刷新画面、Ctrl-Alt-Del、shared 与会话内 view-only；view-only 必须在客户端阻断键盘 / 指针上行并有明显状态标识。
- [ ] **V2.2 剪贴板安全交互**：分别实现“远端 → 本机”和“本机 → 远端”的显式开关、权限与用户手势处理；默认关闭，正文只在内存短暂存在，不写 localStorage、历史、日志或 AI 上下文。
- [ ] **V2.3 会话树与命令面板**：在活动会话侧栏增加独立 VNC 桌面分组，提供显示、只读、重连、断开动作；在 ⌘K 增加适用 VNC 动作，并保证 AI 只能调用显示 / 只读等无副作用界面控制。
- [ ] **V2.4 独立窗口**：扩展 DetachedWorkspace 模型、manager、capability 与前端以支持 detached-vnc-*；窗口移动、回归主窗口、关闭标签、renderer 重新挂载和焦点切换均保留或正确关闭 VncSession，且完整重启 Tauri 验证 capability。
- [ ] **V2.5 交互回归**：真实验证 macOS / Windows 的键盘修饰键、输入法、触控板、DPI、窗口缩放、全屏、深浅主题、隐藏恢复、快速开关标签和 renderer 卸载，修复 WebSocket / canvas / listener 泄漏。

**Phase 2 验收**：VNC 在主窗口和独立窗口间切换后仍可安全交互；只读与两个方向的剪贴板权限均遵守设置；VNC 相关控制不会影响终端 / SFTP 的标签、分屏或快捷键。

### Phase 3：加密直连与服务器身份验证

- [ ] **V3.1 VeNCrypt TLS 测试矩阵**：在受控 TigerVNC / QEMU 环境验证 TLSNone、TLSVnc、TLSPlain、X509Vnc 等实际提供的安全类型，确定首批支持集、TLS 版本、cipher、协议 fallback 和不支持错误；没有完整证据的厂商类型不得暴露为可用选项。
- [ ] **V3.2 TLS 实现与证书策略**：在 Rust 侧实现 TLS / VeNCrypt 协商，使用系统根证书或用户选择的 CA，验证 hostname、链和有效期；自签名证书首次显示 SHA-256 指纹并建立 pin，变更时硬失败。SSH known_hosts 与 X.509 信任记录必须隔离。
- [ ] **V3.3 Direct TCP 发布门禁**：将 direct TCP 的可用性与安全方式绑定：无 TLS 或仅 VNC password 时每次显式确认并显示受限状态；TLS 验证通过后才启用完整直连体验。不得因服务器协商失败而退回明文 / 弱认证。
- [ ] **V3.4 认证与证书数据生命周期**：补齐 username / password 在安全类型适用时的临时输入和 SecretStore 引用，零化挑战、密码、私钥和会话能力；补齐更新、导出、导入、删除、证书替换及错误日志的回归测试。

**Phase 3 验收**：对受信任 CA、自签名首次 pin、证书变更、hostname 不匹配、过期证书、仅弱安全类型和认证失败分别得到正确结果；任何失败均不能降级到未验证直连或泄露秘密。

### Phase 4：恢复、性能与发布验证

- [ ] **V4.1 断线与重连策略**：为 SSH tunnel 与直连分别实现受用户控制的指数退避重连、取消、认证失败停止、最大次数和明确 UI 状态；不得因为网络抖动高频重放密码造成服务器锁定。
- [ ] **V4.2 资源与可观测性**：实现非敏感会话计数、bridge / SSH channel 关闭指标、内存与 listener 诊断，覆盖后台 / 恢复、目标重启、网关断线、DNS / timeout、服务器 resize、反复 renderer 重建与进程退出。
- [ ] **V4.3 互操作与性能矩阵**：在 TigerVNC、QEMU / libvirt 与 x11vnc 等至少三类受控服务器上验证 RFB 3.3 / 3.8、常见 encoding、1080p、网络高延迟、窗口 resize 与键盘输入；记录帧率、CPU、内存和连接耗时基线。
- [ ] **V4.4 端到端安全审计**：审计 Tauri command / event、SQLite、SecretStore、crash error、Toast、前端 console、AI tool、配置导入导出和依赖 NOTICE；确认密码、RFB 帧、clipboard 正文、certificate 私钥、bridge URL 与 token 不可见。
- [ ] **V4.5 CI 与发布验证**：增加 Rust unit / integration 测试和前端组件测试；在 macOS / Windows 完成 pnpm exec tsc --noEmit、pnpm build、cargo fmt、cargo clippy --all-targets -- -D warnings 与 cargo test，并在当次发行构建重新执行真实 VNC 矩阵。

**Phase 4 验收**：所有支持路径的连接、关闭、网络故障、认证失败与恢复不会泄漏资源或敏感数据；跨平台真实服务器矩阵通过后，VNC 才能从试验功能进入发布功能。

### Phase 5：可选增强，不进入首版发布门槛

- [ ] **V5.1 VNC Repeater**：评估并实现独立的 repeater ID / host 路由模型；它不能复用或暴露本地 bridge token。
- [ ] **V5.2 额外认证类型**：在安全与互操作验证后按需支持 RealVNC RSA-AES、Apple Diffie-Hellman、Tight / UltraVNC 特定认证；每种类型独立记录许可证、secret 形态、协商与降级策略。
- [ ] **V5.3 Server capability 优化**：ContinuousUpdates、Fence、ExtendedDesktopSize、质量 / encoding 提示等仅在后端和 noVNC 两侧均已验证时启用，并能回退到标准帧更新。
- [ ] **V5.4 受控导入**：单独设计 .vnc、.tigervnc 或厂商 profile 的导入映射、危险字段过滤、密码处理和预览脱敏；不执行导入文件内的命令或外部引用。
- [ ] **V5.5 录制与审计探索**：如有合规需求，先定义用户可见状态、加密存储、保留期、磁盘配额和敏感屏幕数据告知，再评估录制，不复用 websockify 的流量记录功能。
