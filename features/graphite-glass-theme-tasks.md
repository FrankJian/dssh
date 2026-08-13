# Graphite Glass（冷黑玻璃）主题改造任务

> 对应规格：[`graphite-glass-theme.md`](graphite-glass-theme.md)  
> 状态：实现已完成，待统一人工验收  
> 标记说明：`[x]` 表示代码、文档或小型自动化检查已完成；视觉、性能和跨平台人工验收保留为 `[ ]`。  
> 原则：本文只拆解主题与 CSS 材质工作，不授权修改布局或启用 Tauri 原生窗口透明。

## 0. 执行约束

- [x] 实施前阅读 `TODO.md`、[`graphite-glass-theme.md`](graphite-glass-theme.md)、[`liquid-glass.md`](liquid-glass.md) 与 `.cursor/rules/design.mdc`。
- [x] 所有组件颜色继续通过 `src/theme/global.css` 的语义 token 获取；除 token 定义、xterm 调色板与必须的运行时 alpha 组装外，不新增字面色。
- [x] 不修改 DOM 排版、尺寸、间距、Activity / RightPanel 结构、pane / detached 生命周期。
- [x] 不修改 Tauri 窗口透明、window effects、capability、Rust command 或数据库。
- [ ] 保护终端选区的 WebGL 字形保真约束；没有完成 WebGL / DOM 对照前，不接受高对比选中色。
- [ ] 每个 Phase 的视觉更改都同时检查 dark、light；dark 是主要验收主题，light 不能出现紫色回退。

## Phase 0：基线、冲突清理与验收样本

### T0.1 建立视觉基线

- [ ] 在同一窗口尺寸和缩放比例下保存改造前截图：连接管理、单终端、四分屏、SFTP、S3、AI / Host Tools、设置、Command Palette、右键菜单和 detached workspace。
- [ ] 每个工作区至少包含 default、hover、focus、selected、disabled、success、warning、danger 中适用的状态。
- [ ] 记录 macOS / Windows 的 WebView 版本、系统主题、DPI 与终端 GPU 模式，避免后续截图不可比较。

**验收**：截图可以定位到具体界面与状态；终端壁纸关闭，避免参考图内容影响配色判断。

### T0.2 审计颜色来源

- [x] 统计 `global.css` 中所有颜色 token、字面 `#hex` / `rgb()` / `color-mix()` 以及 `--accent` / `--accent-strong` 的选择器。
- [x] 单独列出 `src/terminal/terminalTheme.ts`、`src/terminal/terminalRegistry.ts`、`src/app/App.tsx` 与 `src/sftp/monacoLoader.ts` 的颜色来源。
- [x] 将 accent 使用分为“应保留的交互强调”“应改为中性文字 / 图标”“状态色误用”三类，形成实施 checklist。
- [x] 搜索 Violet / Nebula / violet 命名，记录代码、注释与文档命中点。

**验收**：所有已知旧紫色来源都有明确归属，没有只靠肉眼寻找遗漏。

### T0.3 对齐两份玻璃规格

- [x] 修订 `features/liquid-glass.md`：本规格负责默认主题的 CSS chrome / overlay 材质；原文保留 Tauri 原生窗口材质、平台探测与强度增强，删除重复的默认 overlay 实现。
- [x] 修订 `TODO.md` 与根 `tasks.md` 中“液态玻璃”条目，使其不再要求第二套 `.is-glass-surface` 或重复 blur。
- [x] 明确后续原生材质开启时复用 `--glass-*` token，任一路径最多两层 filter。

**验收**：`graphite-glass-theme.md` 与 `liquid-glass.md` 不再对默认开关、CSS token 或共享类给出互相矛盾的要求。

### T0.4 建立对比度与性能基线

- [ ] 测量当前 dark / light 的正文、次级文字、焦点、按钮、输入边界和连接状态对比度。
- [ ] 记录四分屏持续输出、SFTP / S3 长列表滚动、Command Palette 打开和连续窗口缩放的主观流畅度及可取得的 FPS / CPU 数据。
- [ ] 记录 xterm WebGL 与 DOM renderer 下活动 / 非活动选区的字形差异。

**Phase 0 验收**：基线、颜色清单、规格边界与测试矩阵齐备；本阶段不改变产品外观。

## Phase 1：语义 token 与新调色板

### T1.1 替换深色核心 token

- [x] 将 `src/theme/global.css` 顶部的 Violet / Nebula 注释改为 Graphite Glass。
- [x] 按规格第 7.1 节替换 `--bg-*`、border、text、accent、selection、button、status 与 code token。
- [x] 增加 `--glass-*`、环境光和透明终端所需的语义 token。
- [x] 保持现有 token 名尽可能兼容，只有一个颜色职责确实无法表达时才新增 token。
- [x] 将 scrollbar 的字面色迁入语义 token，确保它不比正文和活动状态更抢眼。

**验收**：手动禁用所有玻璃规则时，纯色 Graphite 调色板已经成立；代码中不再依赖旧紫黑值。

### T1.2 替换浅色核心 token

- [x] 按规格第 7.2 节将浅色主题改为冷白 / 蓝灰，不保留紫色 accent、selection 或 code keyword。
- [x] 为浅色玻璃表面使用更高 alpha，确保文字不被环境底纹污染。
- [x] 保持 `useTheme.ts` 的 `system | light | dark` 存储和跨窗口同步契约不变。

**验收**：light 与 system-light 路径无紫色残留；所有已有 token 均有浅色定义或安全继承。

### T1.3 校准状态与代码语义色

- [x] success / warning / danger / info 按状态职责使用，不把 info 与普通 accent 混为同一个组件状态。
- [x] keyword、string、number、type、comment、find match 在 dark / light 下分别目视校准。
- [ ] 验证错误、断开、重连、首次连接和正常在线可以通过颜色之外的信息区分。

**Phase 1 验收**：只通过替换根 token 即可让全局主体去紫；dark / light 正文达到 AA，状态色不串义。

## Phase 2：CSS 玻璃材质层

### T2.1 增加内部环境底纹

- [x] 在 `.app-shell` 或独立的非交互伪元素增加规格允许的低强度冷色环境层。
- [x] 环境层只能消费 token，不响应 pointer，不动画，不遮挡 terminal / editor / file content。
- [ ] 最大化、Zen、detached workspace 与 light theme 分别确认背景覆盖正确。

**验收**：无壁纸时也能看到轻微空间层次，但截成灰度图后结构仍主要由明度和边界成立。

### T2.2 建立共享玻璃 surface

- [x] 在 `global.css` 实现 `.is-glass-chrome` 与 `.is-glass-overlay`（或不超过三个等价公共类）。
- [x] 统一使用 `backdrop-filter`、`-webkit-backdrop-filter`、`--glass-border`、`--glass-highlight` 和 overlay shadow。
- [x] 增加 `@supports not` 实色 fallback。
- [x] 增加 `prefers-reduced-transparency: reduce` 覆盖：关闭 blur / 环境光，提高 surface alpha。
- [ ] 审计 stacking context、fixed / absolute 定位与 overflow，避免 blur 改变菜单或浮层定位。

**验收**：公共类可以独立演示 Chrome 与 Overlay 两种材质；fallback 不透明、可读、层级明确。

### T2.3 接入主窗口 chrome

- [x] 接入 title bar、activity bar、sidebar、workspace tab strip、session toolbar 与 right dock header。
- [x] 主内容 canvas 不添加 filter；相邻 chrome 不重复叠加 filter。
- [ ] 确认 pane resizer、活动 tab 指示、sidebar 选中行和 dock 分隔线在玻璃背景上仍清晰。

**验收**：从 `.app-shell` 到任意 chrome 的 filter 深度通常为 1，绝不超过 2；四分屏输出时 chrome 不闪烁。

### T2.4 接入浮层与模态

- [x] 接入 Command Palette、context menu、SelectMenu / popover、Toast、Zen 退出条、设置、连接编辑和确认框。
- [x] backdrop 只负责压暗，不与面板同时模糊。
- [x] 清理组件各自不一致的 surface / shadow，统一消费 Overlay / Modal token。
- [ ] 检查菜单滚动、输入法候选、focus trap、点击 backdrop 关闭与 portal 层级。

**验收**：所有主要浮层使用同一材质语言；没有出现双重 blur、边缘脏亮或文字透底。

### T2.5 接入 detached workspace

- [x] 让 detached terminal / SFTP 的外壳和 tab bar 消费同一套 Graphite Glass token / 共享类。
- [x] 修复材质接入中发现的未定义旧 surface token，但不修改 detached 生命周期或 capability。
- [ ] 通过 `storage` 触发的 system / dark / light 变化验证跨窗口同步。

**Phase 2 验收**：主窗口和独立窗口玻璃层级一致；不支持 blur 与减少透明度模式均能完整使用。

## Phase 3：组件强调色减量与状态回归

### T3.1 审计 `--accent-strong` 前景

- [x] 按 T0.2 清单逐项检查 `color: var(--accent-strong)`。
- [x] 普通标题、section icon、静态说明改为 `--text-strong` / `--text-base` / `--text-muted`。
- [x] 只在链接、焦点、活动指示和明确的主交互保留冰蓝。
- [x] 保留成功 / 警告 / 危险自己的状态色，不用 accent 覆盖。

**验收**：默认静止页面的冰蓝面积明显低于文字与中性 surface；没有“整页小图标全发蓝”。

### T3.2 统一交互状态

- [x] 校准 icon button、toolbar button、tree row、tab、connection item、input、select 和 segmented option 的 default / hover / active / focus / disabled。
- [x] hover 默认使用中性 `--bg-hover`，selected 才使用 `--accent-soft`。
- [ ] focus-visible 在 dark / light / glass / fallback 上都不被 `overflow: hidden` 裁切。
- [ ] destructive action 的 hover / focus / disabled 不与 primary action 混淆。

**验收**：仅用键盘可以清楚追踪焦点；active、hover 与 selected 任意两者不会看成同一状态。

### T3.3 工作区逐面回归

- [ ] 连接管理、Session Tree、SFTP、Remote Explorer、S3、AI Chat、Host Tools、设置与 Command Palette 逐面检查。
- [ ] 保持 1px separator、现有 radius 和紧凑密度，不借主题改造引入卡片或营销式留白。
- [x] 删除失效的 Violet 专属注释和 CSS section 名称。

**Phase 3 验收**：所有主要工作区遵守同一色彩职责，未修改布局或交互结构。

## Phase 4：终端与 Monaco 同步

### T4.1 重做 xterm 调色板

- [x] 更新 `src/terminal/terminalTheme.ts` 的 background、foreground、cursor、selection 与 ANSI 16 色。
- [x] 将 Nebula / violet 注释改为 Graphite 说明，保留 WebGL 选区字形原理注释。
- [x] 活动 / 非活动 selection 从 `#182630` / `#121c24` 起校准，确保可发现但不改变字形观感。
- [ ] 验证 ANSI red / green / yellow / blue / magenta / cyan 及 bright 版本在冷黑底上的区分度。

**验收**：终端无品牌紫色光标或选区；ANSI magenta 仅作为内容色存在；WebGL / DOM 选区均通过目视检查。

### T4.2 消除终端旧底色硬编码

- [x] `src/app/App.tsx` 的 `--terminal-surface` 透明 alpha 从新的语义颜色源生成。
- [x] `src/terminal/terminalRegistry.ts` 的 transparent theme 使用同一来源或与之严格同步的常量。
- [x] 仅在当前 WKWebView / WebView2 支持 `backdrop-filter` 或 `-webkit-backdrop-filter` 时显示终端背景图，并在壁纸遮罩层应用一次磨砂效果；不支持时不显示图片。
- [x] 在终端设置中持久化背景图磨砂开关与 4–32px 模糊度；关闭磨砂时不显示背景图。
- [ ] 检查 welcome terminal、terminal wallpaper、100% / 0% / 中间 opacity、分屏和 detached terminal。
- [x] 不改变 `allowTransparency`、GPU fallback 或 terminal wallpaper 的既有判定逻辑。

**验收**：全仓库不存在旧 `rgba(20, 20, 28, …)`；所有终端路径的底色一致。

### T4.3 重命名并校准 Monaco 主题

- [x] 将 `dssh-violet-dark/light` 改为 `dssh-graphite-dark/light`。
- [x] 继续从 CSS token 读取 editor / widget / selection / syntax 颜色，不复制调色板。
- [ ] 检查运行时主题切换、suggestion widget、find match、selection、inactive selection 与当前行。
- [x] 编辑器正文保持不透明或近不透明，不挂 glass surface。

**Phase 4 验收**：terminal、Monaco 与 app chrome 属于同一视觉体系，同时各自保持内容可读性和渲染约束。

## Phase 5：文档与命名迁移

### T5.1 更新当前产品文档

- [x] 更新 `README.md` 的视觉简介。
- [x] 更新 `spec.md` 的视觉系统章节、token 表、终端主题说明和选区值。
- [x] 更新 `AGENTS.md` 的 UI conventions：Graphite Glass 为当前视觉身份，语义 token 规则不变。
- [x] 重新生成冷石墨、雾白与冰蓝配色的桌面应用图标，并派生 macOS、Windows 与 Web 所需资源。

### T5.2 清理 feature 文档旧名称

- [x] 更新 `features/monaco-editor-integration.md`、`features/vnc-workspace.md` 等仍引用 Violet / Nebula 的说明。
- [x] 全仓库搜索 `Violet|Nebula|violet|dssh-violet`，只允许历史决策记录中保留，并明确其为旧主题。
- [x] 检查示例截图 / 文案是否把参考图布局或壁纸误写为产品要求。

**Phase 5 验收**：代码注释和当前文档统一使用 Graphite Glass 或中性“全局主题 token”称呼；规划文档边界一致。

## Phase 6：验证与发布门槛

### T6.1 静态与构建验证

- [x] 运行 `pnpm exec tsc --noEmit`。
- [x] 完成 Vite 临时目录生产构建（未写入仓库 `dist/`）。
- [x] 检查构建输出没有 CSS 语法、unsupported value 或 Monaco theme 错误。

### T6.2 对比度与辅助功能

- [x] 测量 dark / light 的正文、muted、faint、link、primary、danger、input border 与 focus ring。
- [ ] 对半透明 surface 在环境底纹最亮 / 最暗位置分别采样。
- [ ] 验证 `prefers-reduced-transparency`、键盘导航、focus-visible 和禁用态。
- [ ] 不达标时优先提高 surface alpha 或文字明度，不用文字阴影补救。

### T6.3 性能回归

- [ ] 对照 T0.4 复测四分屏持续输出、SFTP / S3 长列表滚动、Command Palette 与连续窗口缩放。
- [ ] 使用开发者工具确认没有为列表行或终端单元创建 filter 合成层。
- [ ] 如出现稳定回退，按“降低 blur → 减少 filter surface → 实色 fallback”的顺序修正。

### T6.4 跨平台视觉矩阵

- [ ] macOS 与 Windows 11 完成规格第 13 节全矩阵。
- [ ] Windows 10 或不支持 blur 的环境完成 fallback 验证。
- [ ] 主窗口、detached terminal、detached SFTP、普通 / 最大化 / Zen 均留存验收截图。
- [ ] 对比参考图时只评估配色、层次和克制度，不以复刻布局或壁纸为通过条件。

### T6.5 最终残留检查

- [x] 搜索旧紫色 hex / rgba、旧主题名和硬编码 terminal background。
- [x] 检查所有新增颜色是否只存在于 token 或专用终端调色板中。
- [x] 检查 git diff，确认没有生成 `dist/`、`src-tauri/target/` 或无关布局改动。

**Phase 6 / 发布验收**：[`graphite-glass-theme.md`](graphite-glass-theme.md) 第 14 节九项全部通过，构建验证无错误，跨平台截图和对比度记录可复核。

## 建议提交拆分

为降低 9,000+ 行 CSS 的评审风险，建议按以下提交边界实施：

1. `docs: align graphite glass theme specifications`
2. `style: replace violet palette with graphite tokens`
3. `style: add shared glass surfaces and fallbacks`
4. `style: reduce accent usage across component states`
5. `style: align terminal and monaco palettes`
6. `docs: update visual identity and validation evidence`

每个提交都应可单独构建；不要把布局重构、Rust 原生材质或其他 feature 混入主题提交。
