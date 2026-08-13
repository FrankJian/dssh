# 液态玻璃（原生窗口材质）规格

> 状态：待实现的可选增强。默认的应用内 Graphite Glass 配色、chrome / 浮层磨砂、实色 fallback 与减少透明度降级，已由 [`graphite-glass-theme.md`](graphite-glass-theme.md) 定义并实施。
> 本文只定义“透出桌面背景”的原生窗口材质。该效果**默认关闭**，必须由用户显式开启；开启后不得降低终端可读性，也不得改变现有布局密度。

## 1. 结论：默认 CSS 玻璃与原生窗口材质必须分层

“液态玻璃”在桌面应用里其实是两件不同的事，能力、风险和跨平台一致性完全不同。必须分层实现，不能当成一个开关。

| 层 | 做法 | 平台 | 归属 |
| --- | --- | --- | --- |
| **A. 应用内玻璃** | CSS `backdrop-filter` + Graphite Glass 半透明 token，模糊应用自身下层内容 | WebView2 / WKWebView | 已实现；不新增设置或第二套类 |
| **B. 窗口材质** | `transparent: true` + Tauri `windowEffects`（Windows Mica / Acrylic、macOS Vibrancy），模糊**桌面背景** | Windows 11 / macOS 10.14+ | 本文主责；会影响缩放性能、resize 边框与启动首帧 |

应用内玻璃已经覆盖命令面板、模态、右键菜单、下拉浮层、Toast 与 workspace chrome，且不依赖窗口透明。B 才是“整个应用透出桌面”的效果，代价明显更大。因此后续设置只控制 B，不能关闭或再次实现 A。

macOS 26 的原生 Liquid Glass（`NSGlassEffectView`）只能通过私有 API 触及（社区插件 `tauri-plugin-liquid-glass` / `electron-liquid-glass` 都是这么做的）。**首版不引入私有 API**：它不受 Apple 文档保障、可能随系统小版本失效，且会影响 App Store 分发资格。首版在 macOS 上用公开的 `NSVisualEffectView` 材质（Tauri `Effect::UnderWindowBackground` / `HudWindow` / `Sidebar`），观感接近；真·Liquid Glass 见第 9 节可选阶段。

## 2. 目标与非目标

### 目标

- 在设置 → 外观中提供原生窗口材质控制：**关闭 / 整窗**两档；若平台和 Phase 0 结论允许，切换后立即生效，无需重启。
- 复用 Graphite Glass 的深浅主题 token，两套都保证正文与图标达到 WCAG AA 对比度。
- 主窗口与所有 `detached-*` 独立窗口表现一致，且跨窗口实时同步。
- 平台不支持时自动降级并在设置里说明原因，不出现“开了没反应”的哑状态。
- 终端默认仍然完全不透明；原生材质只透过外壳 chrome 与窗口底板。

### 非目标

- 不引入毛玻璃之外的装饰：不加高光描边动画、不加卡片阴影层叠、不加视差、不改圆角与间距体系（`.cursor/rules/design.mdc` 依然是约束）。
- 不把玻璃作用于终端画布、Monaco 编辑器正文、SFTP / S3 文件列表等**内容区**——这些地方可读性优先。
- 不改动现有终端背景图与终端不透明度功能，也不用玻璃取代它们。
- 首版不引入 macOS 私有 API，不引入 Linux 支持（项目当前只发布 Windows / macOS）。
- 不为玻璃新增任何后端数据存储；它是纯前端偏好 + 窗口属性。
- 不重新实现、覆盖或条件化 Graphite Glass 的 `.is-glass-chrome` / `.is-glass-overlay`。

## 3. 当前代码基线

调研结论，实施前的事实：

- `src-tauri/tauri.conf.json:12-21` 主窗口只有 `decorations: false`，**没有** `transparent`、`windowEffects`、`backgroundColor`；`app.macOSPrivateApi` 未开启。
- `src-tauri/tauri.macos.conf.json:10-24` 覆盖为 `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle: true`。两个配置都要改。
- `src-tauri/Cargo.toml` 的 `tauri` 没有 `macos-private-api` feature；`window-vibrancy` 只是 Tauri 的传递依赖，应用代码未使用。
- 独立窗口在 `src-tauri/src/workspace/mod.rs:140-160` 用 `WebviewWindowBuilder` 创建，同样没有透明或材质设置。
- `src-tauri/capabilities/default.json`（`main`）与 `capabilities/detached-workspace.json`（`detached-*`）都没有 `core:window:allow-set-effects`。
- `src/theme/global.css` 已定义 Graphite Glass token、`.is-glass-chrome` 与 `.is-glass-overlay`；这些 CSS 表面不依赖窗口透明。
- `src/theme/useTheme.ts` 用 `document.documentElement.dataset.theme` 落地，并监听 `storage` 事件做跨窗口同步——原生窗口材质偏好应照抄该模式。
- `src/settings/SettingsDialog.tsx:43` 的 `SettingsCategory` 已有 `"appearance"`，其 UI 在 445-502（主题 + 左侧导航栏），玻璃控件加在这里。
- 终端已有独立的半透明通道：`settings.ts` 的 `dssh.terminal.bgOpacity` → `App.tsx` 写 `--terminal-surface`，`TerminalView.tsx` 据此决定 xterm 的 `allowTransparency`。原生窗口材质必须与它协同，不能各算各的。
- `--bg-base` / `--bg-raised` 已映射至现有语义 surface token，独立窗口可复用同一套材质。

## 4. 设置模型

原生窗口材质采用两档模式；Graphite Glass 的应用内磨砂始终由全局主题提供，不是这个设置项的一部分。可选强度仅作用于后续原生材质：

```ts
// src/settings/settings.ts
export const appearanceGlassModeKey = "dssh.appearance.glassMode";
export const appearanceGlassIntensityKey = "dssh.appearance.glassIntensity";

export type GlassMode = "off" | "window";
export type GlassIntensity = "low" | "medium" | "high";

export const GLASS_MODE_DEFAULT: GlassMode = "off";
export const GLASS_INTENSITY_DEFAULT: GlassIntensity = "medium";
```

| 模式 | 效果 | 依赖 |
| --- | --- | --- |
| `off` | 保留 Graphite Glass 的应用内 chrome / 浮层材质，不透出桌面 | 无 |
| `window` | 在 Graphite Glass 基础上，窗口底板与 chrome 透出桌面 | 窗口透明 + 系统材质 |

强度只映射到两个数值，不引入更多变量：

| 强度 | `--glass-blur` | chrome 表面 alpha | 浮层 alpha |
| --- | --- | --- | --- |
| `low` | 8px | 0.88 | 0.92 |
| `medium` | 16px | 0.76 | 0.86 |
| `high` | 28px | 0.62 | 0.78 |

（具体数值在 Phase 1 按对比度实测校准，此处为起点。）

**降级规则**，按顺序判定，第一条命中即生效：

1. 用户选 `window` 但平台不支持（Windows 10、无 DWM 合成、macOS < 10.14）→ 按 `off` 渲染，设置里该选项禁用并说明原因。
2. 系统开启“减少透明度” → 不施加原生窗口材质；Graphite Glass CSS 按自己的实色 fallback 渲染。
3. `backdrop-filter` 不被支持 → 只影响 Graphite Glass 的 CSS fallback，不改变窗口材质能力判定。

## 5. 前端实现约定

### 5.1 Token 层

在 `:root` 上追加 `data-window-material` 属性（与 `data-theme` 平行，由 `useGlassSettings` 写入）：

```
<html data-theme="dark" data-window-material="window" data-window-material-intensity="medium">
```

`global.css` 已在主题 token 后定义 `--glass-*`，并以 `.is-glass-chrome` / `.is-glass-overlay` 集中承载 `backdrop-filter`。原生窗口材质只允许 `[data-window-material="window"]` 追加覆盖 `.app-shell` 的窗口底板透明度；不得重定义 chrome / overlay token，不得新增第二组玻璃类。

### 5.2 层数上限

`backdrop-filter` 每一层都是一次 GPU pass，且会建立层叠上下文与包含块。硬性约束：

- 从 `.app-shell` 到任意一个磨砂表面，**嵌套的 `backdrop-filter` 不得超过 2 层**。模态浮在磨砂 chrome 上时，模态自身磨砂、其遮罩层只用半透明底色，不再叠模糊。
- 磨砂表面必须是稳定的容器（chrome、浮层），不得挂在会频繁重排或滚动的列表项上。
- 终端画布所在的 `.terminal-stage` / `.pane-grid` 一律不加 `backdrop-filter`。

### 5.3 需要处理的表面

| 表面 | 类名 | Graphite Glass（默认） | 原生 `window` |
| --- | --- | --- | --- |
| 应用底板 | `.app-shell` | 冷黑环境底纹 | 透明 + 系统材质 |
| 标题栏 / 活动栏 / 左侧栏 / 标签条 / 右侧 dock | `.is-glass-chrome` | 磨砂 | 复用默认规则 |
| 命令面板 / 模态 / 菜单 / 下拉 / Toast / Zen 退出条 | `.is-glass-overlay` 或已有公共规则 | 磨砂 | 复用默认规则 |
| 模态遮罩 | `.profile-editor-backdrop` / `.palette-backdrop` | 仅压暗 | 仅压暗 |
| 独立窗口外壳 | `.detached-workspace` / `.detached-workspace__tabbar` | 同一套 token | 复用默认规则 |
| 终端 / 编辑器 / 文件列表 | — | 不处理 | 不处理 |

`html`、`body`、`#root`、`.app-root` 仅在 `data-window-material="window"` 下改为透明；默认 Graphite Glass 始终保持当前应用内画布。

## 6. 窗口材质实现约定（`window` 模式）

### 6.1 透明是创建期属性，材质才是运行期属性

Tauri 的 `transparent` 只能在窗口创建时确定，`setEffects` / `clear_effects` 才能运行时改。为了做到“切换不重启”，采用：

- **窗口永远以 `transparent: true` 创建**（主窗口 + `detached-*`）。
- `off` 时不施加任何系统材质，并保留 Graphite Glass 的应用内画布与 chrome / overlay 材质。
- `window` 时由 Rust 施加平台材质，CSS 同步把底板改成透明。

这条决策的代价必须在 Phase 0 验掉（见 6.4），否则退回“切换需重启”的保守方案。

### 6.2 平台材质选择

| 平台 | 首选 | 说明 |
| --- | --- | --- |
| Windows 11（build ≥ 22000） | `Effect::Mica` / `MicaDark` / `MicaLight` | 采样壁纸而非实时内容，性能最稳，随主题选择变体 |
| Windows 11，用户显式选择 | `Effect::Acrylic` | 实时采样、观感更“玻璃”，但**已知在拖动 / 缩放时掉帧**，必须在 UI 上标注性能代价，不作默认 |
| Windows 10 | 不支持 | `Blur` / `Acrylic` 在 Win10 1903+ 性能问题严重，直接判定不支持并降级 |
| macOS 10.14+ | `Effect::UnderWindowBackground`（主底板）+ `Sidebar`（侧栏区域，如需） | 公开 `NSVisualEffectView` 材质；配 `EffectState::FollowsWindowActiveState` |

材质随 `data-theme` 变化需要重新施加（Windows 的 Mica 变体、macOS 的 appearance）。

### 6.3 命令与权限

平台探测（Windows build 号、macOS 版本、DWM 合成状态）在 JS 里做不了，因此走 Rust 命令而不是前端 `setEffects`，顺带避免给 WebView 开窗口 ACL：

```rust
// src-tauri/src/commands/window_material.rs
#[tauri::command]
fn window_material_support() -> WindowMaterialSupport; // { windowMode: bool, acrylic: bool, reason: Option<String> }

#[tauri::command]
fn apply_window_material(window: Window, material: WindowMaterialRequest) -> Result<(), AppError>;
```

- DTO 放 `src-tauri/src/models/`，命令注册进 `lib.rs`，载荷 camelCase，前端服务层 `src/services/windowMaterialService.ts` 统一走 `invokeCommand` 规范化 `AppError`。
- 每个窗口（主窗口和每个 `detached-*`）各自调用一次；独立窗口在 `workspace/mod.rs` 创建后立即按当前偏好施加。
- 若最终改为前端直接 `setEffects`，则 `capabilities/default.json` 与 `capabilities/detached-workspace.json` **都**要加 `core:window:allow-set-effects`，且改完必须完整重启 Tauri（HMR 不重载 capability）。

### 6.4 必须先验证的窗口行为

透明 + 无边框在 Windows 上历史上会破坏这些，Phase 0 逐项实测，任一不可接受则本模式不发布：

1. 窗口边缘拖拽缩放、贴边分屏（Win+方向）、双击标题栏最大化、任务栏预览。
2. 最大化时 `.app-shell` 的 6px 圆角必须变直角，否则四角露出桌面。
3. 启动首帧闪烁（社区已知问题：`transparent: true` 会在首屏出现闪白）。缓解方案是窗口 `visible: false` 创建、前端首帧渲染后再调命令显示——本项目目前没有这个流程，需要新增。
4. 反面收益：多份报告称 `transparent: true` 反而改善 WebView2 的缩放重绘伪影，需一并记录基线。
5. macOS 需要 `app.macOSPrivateApi: true` + `tauri` crate 的 `macos-private-api` feature。这会**影响 Mac App Store 分发资格**；本项目经 GitHub Releases + updater 分发，可接受，但必须在文档里写明。

## 7. 与终端的协同

这是最容易做坏的部分。终端已经有自己的一套半透明机制，两者会叠加。

- **默认不叠加**：`dssh.terminal.bgOpacity` 默认 100%，此时终端表面完全不透明，`window` 模式下玻璃只出现在 chrome 上，终端正文可读性零影响。
- **允许叠加但要讲清楚**：用户同时调低终端不透明度 + 开 `window`，桌面会透过终端。这是合理诉求，予以保留，但设置里的说明文案要改成描述实际行为，并把 `SettingsDialog.tsx:598-603` 那句“暂未开启”删掉。
- **合成顺序**必须是：桌面/系统材质 → `.app-shell` 底板 → `--terminal-surface` → xterm 画布。不得出现两层半透明黑叠成看不清的糊色，Phase 4 用实际截图核对。
- **WebGL 注意**：`TerminalView.tsx` 只有在有壁纸或 `backgroundAlpha < 1` 时才开 `allowTransparency`。玻璃**不得**改变这个判定——不能因为开了窗口材质就强制终端走透明路径，那会平白引入 WebGL 透明渲染开销。
- 选中色仍按 `terminalTheme.ts:13-22` 的既有理由贴近背景；玻璃开启后要重新目视确认选中态没有变成“看不见”。

## 8. 可访问性与设计约束

- 开启玻璃后，正文（`--text-primary`）与图标在**最坏背景**（纯白桌面、亮色壁纸、深色壁纸）下都必须 ≥ WCAG AA 4.5:1。达不到就提高 chrome alpha，而不是加深字色。
- 必须支持 `prefers-reduced-transparency: reduce` 自动降级到 `off`。
- 不新增任何动画；模式切换是即时的样式替换，不做过渡动画（`design.mdc`：仅 150ms 内的透明度/颜色过渡，且不能延迟输入）。
- 不因为玻璃改变任何间距、圆角、字号或分隔线粗细。玻璃只换表面，不换布局。
- 焦点环、选中态、禁用态、错误态在磨砂背景上仍需可辨，不能只靠颜色。

## 9. 实施阶段

1. **Phase 0 可行性与基线**：透明窗口在 Windows 11 / macOS 上的窗口行为与性能实测，决定“免重启切换”是否可行。
2. **Phase 1 原生材质状态**：`data-window-material`、偏好持久化、跨窗口同步与能力感知；复用 Graphite Glass token，不重做 CSS 磨砂。
3. **Phase 2 设置与状态**：`useGlassSettings`、localStorage、跨窗口 `storage` 同步、外观设置 UI、能力感知的禁用态。
4. **Phase 3 窗口材质**：Tauri 配置、Rust 命令与平台探测、主窗口与独立窗口施加、最大化圆角、首帧闪烁处理。
5. **Phase 4 终端与内容协同**：合成顺序、终端不透明度叠加、文案更新、Zen / 分屏 / 独立窗口回归。
6. **Phase 5 验收与发布**：性能矩阵、对比度审计、跨平台人工验收、全套 `tsc` / `build` / `fmt` / `clippy` / `test`。
7. **Phase 6（可选，非发布门槛）** macOS 26 原生 Liquid Glass：`NSGlassEffectView` 属私有 API，需单独评审可用性、失效兜底与分发影响，通过后才作为 macOS 26+ 的增强材质，不得成为默认路径。

分阶段任务清单见 [`tasks.md`](../tasks.md#原生窗口材质桌面透视)。

## 10. 验收标准

- 原生窗口材质关闭 / 整窗 × 深浅主题 × Windows 11 / macOS 全部目视正确，切换即时生效且无需重启。
- Windows 10 与开启“减少透明度”的机器上，UI 呈现明确的降级说明，不出现无效开关。
- 主窗口与独立窗口表现一致；在一个窗口改设置，另一个窗口同步更新。
- 开启 `window` + `high` 强度时：终端连续输出（`cat` 大文件）帧率与内存相对 `off` 基线的回退在可接受范围内并有记录；窗口拖动 / 缩放无肉眼卡顿（Acrylic 除外，其代价需单独记录并在 UI 标注）。
- 终端默认不透明度下，正文渲染与 `off` 状态逐像素一致。
- 对比度审计通过；`prefers-reduced-transparency` 生效。
- `pnpm exec tsc --noEmit`、`pnpm build` 通过；改动 Rust 后 `cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test` 通过。

## 11. 决策记录

- **应用内玻璃与原生材质分开**：默认 Graphite Glass 不承担窗口透明风险；后续原生材质只控制桌面透视。
- **窗口恒定透明、材质运行期切换**：Tauri 的 `transparent` 不可运行时变更，这是唯一能做到免重启切换的路径；代价（首帧闪烁、窗口行为）由 Phase 0 兜底验证。
- **走 Rust 命令而非前端 `setEffects`**：平台能力探测必须在 Rust 侧完成，顺带避免给 WebView 扩权。
- **首版不用 macOS 私有 API**：`NSGlassEffectView` 无文档保障、可能随系统更新失效，且影响分发资格。公开 vibrancy 材质已能达成设计目标。
- **原生桌面透视默认关闭**：Graphite Glass 是默认外观；桌面透视仍是高风险可选偏好。
