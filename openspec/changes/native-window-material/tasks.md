# Tasks

> 导入 2026-11-21 前已有任务；复选状态逐项保留。导入完成不代表功能实现或验收通过。
> 来源：根 `tasks.md`。旧控件类、Graphite 名称和“合并回主窗口”表述属于原方案，实现以当前设计规则与工作台所有权为准；先核对差异，不能直接沿用旧实现假设。

> 原 G1.1 的已完成仅指 CSS 玻璃基线，不表示原生窗口材质已实现。Phase 6 可选。

## 原生窗口材质（桌面透视）

> 状态：待实现的可选增强。默认 Graphite Glass 的 token、应用内 chrome / 浮层材质、fallback 与终端协同已在 [`features/graphite-glass-theme.md`](../../../docs/history/graphite-glass-theme.md) 实现；这里仅保留 Tauri 原生窗口材质。实施严格遵循 [液态玻璃规格](design.md) 的 Phase 0 → 1 → 2 → 3 → 4 → 5；Phase 6 为可选增强，不属于发布门槛。原生材质默认关闭；后续窗口实现必须先通过 Phase 0 的窗口行为验证。

## 1. Phase 0：可行性与基线

- [ ] 1.1 **G0.1 透明窗口行为 spike**：在临时分支给主窗口加 `transparent: true`，在 Windows 11 与 macOS 上逐项实测边缘拖拽缩放、贴边分屏、双击标题栏最大化、最小化 / 恢复、任务栏与 Dock 预览、多显示器 DPI 切换。任一项破坏且无可接受缓解时，`window` 模式退回“切换需重启”或直接不发布。
- [ ] 1.2 **G0.2 启动闪烁与显示时机**：验证 `transparent: true` 在 Windows 打包产物上的首帧闪白程度；如需缓解，设计 `visible: false` 创建 + 前端首帧后调用命令显示的流程，并确认它不影响 updater、深链接与独立窗口。
- [ ] 1.3 **G0.3 材质可用性探测**：确定 Windows build 号 / DWM 合成状态、macOS 版本的探测方式与判定阈值（Win11 22000 起支持 Mica；Win10 判定为不支持），产出 `WindowMaterialSupport` 的字段定义与不支持原因文案。
- [ ] 1.4 **G0.4 性能基线**：在开启材质前记录基线：终端 `cat` 大文件的帧率与 CPU、窗口拖动 / 缩放平滑度、常驻内存。分别记录 Mica、Acrylic、macOS vibrancy 三种材质开启后的同一组数据，确认 Acrylic 的拖拽 / 缩放掉帧程度是否需要在 UI 上标注或直接不提供。
- [ ] 1.5 **G0.5 WebView 能力核对**：确认 WebView2 与 WKWebView 对 `backdrop-filter`、`@supports not (backdrop-filter: ...)`、`prefers-reduced-transparency` 的实际支持情况，以及嵌套磨砂层的渲染代价，据此锁定第 5.2 节的两层上限。

**Phase 0 验收**：三种材质在两个平台各有一组可比的性能与窗口行为记录；“免重启切换”是否可行有明确结论。结论为否时更新规格再进入 Phase 3，但不阻塞 Phase 1、2。

## 2. Phase 1：原生材质偏好模型（不重做 CSS 玻璃）

- [x] 2.1 **G1.1 Graphite 基线**：`--bg-base` / `--bg-raised` 已映射到语义 surface token；`--glass-*`、`.is-glass-chrome` / `.is-glass-overlay`、实色 fallback 与减少透明度覆盖均由 Graphite Glass 实现。人工视觉验收仍待统一执行。
- [ ] 2.2 **G1.2 原生材质状态**：新增仅用于桌面透视的 `data-window-material="off|window"` 和偏好解析；不得新增 `overlay` 模式、`data-material` 或第二套 CSS 磨砂类。
- [ ] 2.3 **G1.3 原生材质 token 覆盖**：只在 `data-window-material="window"` 下调整窗口底板透明度，复用已有 `--glass-*` 与表面 token；不改变终端、编辑器或文件列表背景。
- [ ] 2.4 **G1.4 降级路径**：原生材质不支持时回退到 `off`；Graphite Glass 的 `@supports` / 减少透明度 fallback 继续独立生效。
- [ ] 2.5 **G1.5 对比度校准**：在真实桌面亮 / 暗背景、深浅主题下测量原生材质合成后的正文、次级文字与图标，最终值回写规格。

**Phase 1 验收**：原生偏好不会改写默认 Graphite Glass 表面；不支持的环境稳定退回默认主题。

## 3. Phase 2：设置项与状态管理

- [ ] 3.1 **G2.1 设置常量**：在 `src/settings/settings.ts` 增加 `appearanceGlassModeKey` / `appearanceGlassIntensityKey`、`GlassMode`（仅 `off | window`）/ `GlassIntensity` 类型、默认值与解析函数，沿用现有 `parseBoolean` 一类的容错风格。
- [ ] 3.2 **G2.2 `useGlassSettings`**：新增 hook 管理模式与强度，写 localStorage，写 `document.documentElement.dataset.windowMaterial` / `dataset.windowMaterialIntensity`，并**照抄 `useTheme` 的 `storage` 事件监听**实现跨窗口同步（现有 `useTerminalSettings` 没有这一层，不要以它为模板）。
- [ ] 3.3 **G2.3 外观设置 UI**：在 `SettingsDialog.tsx` 的 `“appearance“` 分类中，主题之后新增“原生窗口材质”区块：关闭 / 整窗两档（沿用 `.settings-theme__option` 的分段按钮样式）+ 可选强度；不支持的选项禁用并给出原因。不得提供关闭默认 Graphite Glass 的选项。
- [ ] 3.4 **G2.4 接线主窗口与独立窗口**：在主窗口与独立工作台共用的 `App.tsx` 中接入 hook；确认不同窗口能通过 `storage` 同步实时更新。
- [ ] 3.5 **G2.5 文案更新**：把“窗口对桌面的整体透明需要系统级窗口透明，暂未开启”改为说明“Graphite Glass 默认只作用于应用内 chrome / 浮层；整窗桌面透视需要系统级窗口透明”。

**Phase 2 验收**：设置里切换模式与强度立即生效并持久化；重开应用与打开独立窗口都保持一致；`off` 状态保留默认 Graphite Glass。

## 4. Phase 3：窗口材质（`window` 模式）

- [ ] 4.1 **G3.1 Tauri 窗口配置**：`tauri.conf.json` 与 `tauri.macos.conf.json` 主窗口均加 `transparent: true`；macOS 追加 `app.macOSPrivateApi: true` 并给 `tauri` crate 开 `macos-private-api` feature。在 README / 规格中记录其对 Mac App Store 分发的影响。
- [ ] 4.2 **G3.2 Rust 命令与 DTO**：新增 `window_material_support` 与 `apply_window_material` 命令、`models/` 下的 camelCase DTO，注册进 `lib.rs`；实现 Windows（Mica / MicaDark / MicaLight，显式选择时 Acrylic）与 macOS（`UnderWindowBackground` + `FollowsWindowActiveState`）的材质施加与清除，错误按 `AppError` 约定返回。
- [ ] 4.3 **G3.3 前端服务层**：新增 `src/services/windowMaterialService.ts`，经 `invokeCommand` 规范化错误；应用启动时探测一次能力并缓存，供设置 UI 的禁用态使用。
- [ ] 4.4 **G3.4 独立窗口一致性**：`workspace/mod.rs` 的 `WebviewWindowBuilder` 同步加 `transparent`，窗口创建后按当前偏好施加材质；确认 `detached-*` 全部覆盖。若最终改走前端 `setEffects`，则 `capabilities/default.json` 与 `capabilities/detached-workspace.json` 都要加 `core:window:allow-set-effects`，并**完整重启 Tauri** 验证（HMR 不重载 capability）。
- [ ] 4.5 **G3.5 主题联动**：`data-theme` 变化时重新施加材质（Windows 的 Mica 变体、macOS 的 appearance），包含跟随系统主题的自动切换路径。
- [ ] 4.6 **G3.6 窗口几何**：最大化 / 全屏时把 `.app-shell` 的 6px 圆角改为直角，避免四角漏出桌面；同时核对 Zen 模式与独立窗口。
- [ ] 4.7 **G3.7 首帧显示流程**：若 G0.2 判定需要，实现 `visible: false` 创建 + 前端首帧后显示，并确认对启动耗时、updater 与独立窗口无副作用。

**Phase 3 验收**：Windows 11 与 macOS 上 `window` 档真实透出桌面并可免重启切换；Windows 10 与不支持环境自动降级；主窗口与独立窗口一致；窗口缩放、分屏、最大化、多显示器行为与改动前无差异。

## 5. Phase 4：终端与内容协同

- [ ] 5.1 **G4.1 合成顺序核对**：逐档核对“系统材质 → `.app-shell` → `--terminal-surface` → xterm 画布”的实际叠加结果，确保不会叠成糊色；必要时限制终端不透明度与玻璃强度的组合。
- [ ] 5.2 **G4.2 保持终端透明路径不变**：确认 `TerminalView.tsx` 的 `allowTransparency` 判定仍只由壁纸与 `backgroundAlpha` 决定，玻璃开启不得强制终端走 WebGL 透明渲染。
- [ ] 5.3 **G4.3 内容区豁免**：确认终端画布、Monaco 编辑器正文、SFTP / S3 / 远端文件树列表均未被磨砂波及，滚动性能无回退。
- [ ] 5.4 **G4.4 终端选中态复核**：按 `terminalTheme.ts:13-22` 的既有理由，目视确认玻璃开启后选中文字仍清晰可辨，必要时只调整选中色而不改渲染路径。
- [ ] 5.5 **G4.5 工作区回归**：Zen 模式、分屏（最多四格）、标签拖拽重排、独立窗口分离与回归、命令面板、右键菜单、Toast 在原生材质关闭 / 整窗两档下逐一目视回归。

**Phase 4 验收**：终端默认不透明度下渲染与 `off` 状态一致；开启玻璃后所有工作区形态无视觉错位、无可读性下降、无滚动掉帧。

## 6. Phase 5：验收、性能与发布

- [ ] 6.1 **G5.1 性能矩阵**：按 G0.4 的方法复测 `off` / `window`×三档强度的终端吞吐帧率、CPU、内存与窗口拖拽缩放表现，记录进规格；回退超出可接受范围的组合需调低默认强度或移除该档。
- [ ] 6.2 **G5.2 可访问性审计**：完成对比度审计与键盘导航、焦点环、禁用 / 错误 / 破坏性状态在磨砂背景上的可辨性检查；验证 `prefers-reduced-transparency` 在两个平台真实生效。
- [ ] 6.3 **G5.3 跨平台人工验收**：在 Windows 11、Windows 10、macOS 的**打包产物**（不只是 `tauri dev`）上验证原生材质关闭 / 整窗、深浅主题、跟随系统主题、独立窗口、中文输入法与多显示器。
- [ ] 6.4 **G5.4 文档更新**：更新 `README.md` 的功能说明、`spec.md` 的界面约定与已规划功能列表，并把本节完成项压缩为简短记录。
- [ ] 6.5 **G5.5 全套验证**：`pnpm exec tsc --noEmit`、`pnpm build`、`cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test` 全部通过。

**Phase 5 验收**：原生材质关闭时保留默认 Graphite Glass；开启后在两个平台的打包产物上表现稳定、可读、可回退。

## 7. Phase 6：可选增强，不进入发布门槛

- [ ] 7.1 **G6.1 macOS 26 原生 Liquid Glass 评审**：评估经 `NSGlassEffectView` 私有 API（如 `tauri-plugin-liquid-glass`）获得原生 Liquid Glass 的收益与风险，包括系统小版本失效兜底、崩溃隔离、许可证与分发影响。未通过评审不进入实现。
- [ ] 7.2 **G6.2 分区材质**：评估侧栏使用 `Sidebar`、浮层使用 `Popover` / `Menu` 等分区材质，使 macOS 观感更贴近原生；仅在不增加窗口层级复杂度时采纳。
- [ ] 7.3 **G6.3 Windows Acrylic 体验开关**：若 G0.4 显示 Acrylic 代价可接受，则作为显式标注性能代价的高级选项开放；否则保持不提供。
