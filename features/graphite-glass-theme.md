# Graphite Glass（冷黑玻璃）主题改造规格

> 状态：已实现，待统一人工验收  
> 类型：视觉主题与 CSS 材质重构  
> 参考图：仅提取冷黑配色、克制的蓝灰高亮和半透明层次，不复制其排版、终端壁纸、品牌或功能布局。  
> 配套任务：[`graphite-glass-theme-tasks.md`](graphite-glass-theme-tasks.md)

## 1. 背景与结论

Duo SSH 当前的 Violet / Nebula 主题以高辨识度紫罗兰为主色，紫色同时出现在活动状态、按钮、焦点、编辑器光标、终端光标和选区中。它容易呈现泛化的“AI 产品”视觉印象，也让大量界面状态争夺注意力。

本次将默认视觉身份改为 **Graphite Glass（冷黑玻璃）**：

- 深色主题以冷黑、石墨灰、雾白为主体，减少明显色相。
- 低饱和冰蓝只承担焦点、选中、链接和主操作，不作为大面积底色。
- 窗口 chrome 与浮层使用克制的半透明、背景模糊、细描边和内高光，形成玻璃拟态层次。
- 终端、Monaco 编辑器、文件列表等工作内容区保持稳定且接近不透明，优先保证文字清晰和滚动性能。
- 保留现有布局、密度、圆角、图标、功能入口和主题切换机制。

这不是“把紫色批量替换成蓝色”，而是重新约束色彩职责：**黑白灰负责层级，冰蓝负责交互，状态色只表达状态**。

## 2. 与现有液态玻璃规划的边界

仓库已有 [`liquid-glass.md`](liquid-glass.md)，其中同时规划了应用内 `backdrop-filter` 与 Tauri 原生窗口材质。本规格重新定义默认主题的 CSS 外观，二者按以下边界执行：

| 范围 | 本规格 | `liquid-glass.md` |
| --- | --- | --- |
| Violet / Nebula 配色替换 | 是，主责 | 否 |
| 默认 chrome / 浮层的应用内玻璃感 | 是，主责 | 后续复用本规格 token 和公共 surface 规则 |
| 透出应用内部环境底纹 | 是 | 可增强 |
| 透出桌面壁纸、Windows Mica / Acrylic、macOS vibrancy | 否 | 是，主责 |
| Tauri 透明窗口、Rust 命令、capability | 否 | 是 |
| 玻璃强度或原生材质设置 | 否 | 是 |

本规格在“主题色与 CSS 浮层材质”上优先。实现开始前必须同步修订 `liquid-glass.md` 中重复的 CSS overlay 定义，避免同一元素叠加两次 `backdrop-filter`。原生窗口材质仍是独立的可选增强，不是本次主题发布的前置条件。

## 3. 目标与非目标

### 3.1 目标

- 默认深色主题不再出现品牌性紫色，整体呈现冷静、专业、接近原生 IDE 的冷黑视觉。
- 深色界面在无壁纸、终端壁纸、主窗口、独立窗口、普通 / 最大化 / Zen 模式下均有一致层级。
- 玻璃效果能被明确感知，但不能依赖桌面透明、背景图片或高饱和渐变才成立。
- 深色与浅色模式都使用同一套语义 token；浅色模式同步去紫，保留为中性冷灰兼容主题。
- 终端 ANSI 色仍可区分，Monaco 语法色仍表达语义，不能为了“全黑白”丢失可读性。
- 正文与必要交互状态满足 WCAG 2.2 AA；焦点不能只靠颜色表达。
- 默认路径的终端吞吐、滚动、分屏和窗口缩放没有可感知性能回退。

### 3.2 非目标

- 不修改 title bar、activity rail、sidebar、tab strip、right dock 的布局结构和尺寸。
- 不复制参考图中的连接管理布局、工具栏排布、终端壁纸或二次元内容。
- 不引入卡片化 dashboard、超大圆角、发光边框、霓虹渐变、动态流体、视差或持续动画。
- 不新增全局主题选择器、原生窗口玻璃强度设置或新的窗口材质持久化字段；终端背景图可单独提供磨砂开关与模糊度。
- 不修改 Tauri 窗口透明配置，不引入私有 API 或新的 Rust 依赖。
- 不重做应用内图标系统、字体、品牌文案或终端背景图功能；桌面应用图标可随 Graphite Glass 调色板同步更新。
- 不改变成功、警告、危险的业务语义，也不把这些状态统一染成冰蓝。

## 4. 从参考图提取的视觉语言

只采用以下视觉信息：

1. **冷黑画布**：主要背景接近黑色，带极轻微蓝灰倾向，不使用紫黑。
2. **相邻层弱对比**：标题栏、侧栏、工具栏、内容区主要靠明度、透明度和 1px 分隔线区分，不靠大色块。
3. **雾白文字**：正文不是纯白，标题或关键值才使用接近白色；次级文字明显退后但仍可读。
4. **单一冷色强调**：活动标签、焦点和主操作使用低饱和冰蓝；强调面积小且位置稳定。
5. **内容优先**：终端内容保持最高对比，背景装饰被压暗，chrome 不抢内容。

在此基础上增加本项目需要的玻璃拟态，但保持 `.cursor/rules/design.mdc` 的紧凑 IDE 风格。

## 5. 当前代码基线

实施前的已知事实：

- `src/theme/global.css` 在 `:root` 和 `:root[data-theme="light"]` 定义深浅两套语义 token，组件基本只消费 token。
- 深色默认底色为 `#16161e` / `#14141c`，`--accent` 为 `#7c6ff0`，选区、代码高亮和终端也带明显紫色。
- `global.css` 超过 9,000 行，`--accent` / `--accent-strong` 被大量复用；只改 token 会去紫，但不会自动解决“强调色使用过多”的问题。
- `src/terminal/terminalTheme.ts` 是独立的 xterm ANSI 调色板；终端选区刻意贴近背景，避免 WebGL 字形抗锯齿看起来变粗。
- `src/app/App.tsx` 和 `src/terminal/terminalRegistry.ts` 仍硬编码 `rgba(20, 20, 28, …)`，它们必须与新的 `--terminal-bg` 同步，不能留下旧紫黑底。
- `src/sftp/monacoLoader.ts` 从 CSS token 读取编辑器颜色，但内部主题名仍是 `dssh-violet-*`。
- `README.md`、`spec.md`、`AGENTS.md` 与部分 feature 文档仍把 Violet / Nebula 作为当前视觉身份。
- 现有 [`liquid-glass.md`](liquid-glass.md) 尚未实施；当前仓库没有 `backdrop-filter`。

## 6. 主题原则与色彩职责

### 6.1 色彩预算

任何常规视图同时出现的非语义强调色最多只有一种：冰蓝。建议遵守以下面积预算：

- 冷黑 / 石墨表面：约 80%–90%。
- 雾白 / 灰文字与图标：约 8%–18%。
- 冰蓝交互强调：通常低于 3%。
- 成功 / 警告 / 危险：仅在对应状态出现，不计入品牌强调色。

冰蓝可以用于：活动标签指示线、键盘焦点环、文本链接、主按钮、当前选择边界、进度中的关键段。它不应默认用于：普通 section 图标、每个 toolbar 图标、静态标题、所有 badge、无交互的装饰线。

### 6.2 表面层级

| 层级 | 用途 | 视觉规则 |
| --- | --- | --- |
| Canvas | `.app-shell` / 主内容底板 | 最深冷黑；可带非常弱的环境光，不模糊 |
| Chrome | title bar、activity、sidebar、tab strip、right dock header | 半透明冷石墨；1px 分隔；12px–16px 模糊 |
| Content | 终端、编辑器、文件表格 / 树 | 近不透明；终端壁纸是唯一例外：仅在壁纸遮罩层使用一次受支持的 `backdrop-filter`，xterm / 编辑器 / 列表本身不使用 |
| Elevated | 菜单、下拉、Toast、非阻塞浮层 | 更高 alpha；16px 模糊；细描边与轻阴影 |
| Modal | 设置、连接编辑、确认框 | 高 alpha 玻璃面板；遮罩只压暗，不叠加模糊 |

玻璃的辨识来自“透明度 + 背景模糊 + 边缘高光”三者的轻量组合，不使用厚重投影或大面积亮渐变。

## 7. 建议 token 与起始色值

以下是实现起点，不是允许随意漂移的情绪板。视觉验收如需调整，颜色可在相邻明度内微调，但必须回写本文并重新完成对比度检查。

### 7.1 深色主题（主主题）

| Token | 起始值 | 职责 |
| --- | --- | --- |
| 根背景 / `--bg-app` | `#0b0e12` | 冷黑画布、终端周边底板 |
| `--bg-activity` | `rgba(10, 13, 17, 0.90)` | 最深 chrome |
| `--bg-titlebar` | `rgba(14, 18, 23, 0.82)` | 标题栏玻璃 |
| `--bg-toolbar` | `rgba(17, 21, 27, 0.84)` | 标签条与工具栏 |
| `--bg-panel` / `--bg-sidebar` | `rgba(18, 23, 29, 0.86)` | 侧栏与 dock |
| `--bg-panel-muted` | `rgba(24, 30, 38, 0.86)` | 次级块 |
| `--bg-sunken` | `#0d1116` | 输入、编辑器与内容凹面 |
| `--bg-elevated` | `rgba(27, 34, 43, 0.92)` | 菜单与浮层 |
| `--bg-hover` | `rgba(231, 240, 247, 0.055)` | 中性 hover |
| `--bg-selected` / `--selection` | `rgba(121, 166, 201, 0.15)` | 选中背景 |
| `--border-subtle` | `rgba(221, 232, 240, 0.085)` | 常规 1px 分隔 |
| `--border-strong` | `rgba(221, 232, 240, 0.16)` | 控件边界与高层表面 |
| `--text-strong` | `#f4f7fa` | 标题、关键值 |
| `--text-base` | `#dde4ea` | 正文 |
| `--text-muted` | `#98a4af` | 次级说明 |
| `--text-faint` | `#707d89` | 辅助元数据、占位文本 |
| `--accent` | `#79a6c9` | 冰蓝焦点与活动状态 |
| `--accent-strong` | `#a8c7de` | 深底上的链接 / 强调前景 |
| `--accent-soft` | `rgba(121, 166, 201, 0.13)` | 轻选中 / 标签背景 |
| `--accent-border` | `rgba(144, 187, 219, 0.42)` | 焦点与选中边界 |
| `--btn-primary-bg` | `#416f8d` | 主按钮，白字对比度约 5.4:1 |
| `--btn-primary-bg-hover` | `#4a7692` | 主按钮 hover，白字对比度约 4.9:1 |
| `--terminal-bg` | `#0b0e12` | xterm 不透明背景 |

深色根背景上的起始对比度：`--text-strong` 约 18.0:1、`--text-base` 约 15.1:1、`--text-muted` 约 7.6:1、`--text-faint` 约 4.6:1。半透明表面必须按实际合成后的最差背景重新测量，不能只引用这组基线数字。

### 7.2 浅色主题（兼容主题）

浅色模式继续存在，但不追求强玻璃感。它使用冷白和蓝灰，确保跟随系统主题不会回到紫色：

| Token | 起始值 |
| --- | --- |
| `--bg-app` | `#f4f6f8` |
| `--bg-activity` | `rgba(231, 235, 239, 0.94)` |
| `--bg-titlebar` / `--bg-toolbar` | `rgba(238, 242, 245, 0.90)` |
| `--bg-panel` / `--bg-sidebar` | `rgba(248, 250, 251, 0.92)` |
| `--bg-sunken` | `#eef1f4` |
| `--bg-elevated` | `rgba(255, 255, 255, 0.94)` |
| `--bg-hover` | `rgba(31, 47, 59, 0.055)` |
| `--bg-selected` | `rgba(66, 111, 141, 0.13)` |
| `--border-subtle` | `rgba(31, 47, 59, 0.10)` |
| `--border-strong` | `rgba(31, 47, 59, 0.20)` |
| `--text-strong` | `#171c21` |
| `--text-base` | `#252b31` |
| `--text-muted` | `#596672` |
| `--text-faint` | `#64717c` |
| `--accent` | `#426f8d` |
| `--accent-strong` | `#2d5d7b` |
| `--accent-soft` | `rgba(66, 111, 141, 0.10)` |
| `--accent-border` | `rgba(45, 93, 123, 0.38)` |

浅色模式下终端默认仍使用深色终端调色板；本次不增加浅色终端主题。

### 7.3 状态色

状态色需要比现有方案略微降饱和，但必须与冰蓝强调色区分：

| 状态 | 深色起始值 | 使用约束 |
| --- | --- | --- |
| Success | `#73c9a2` | 已连接、完成、健康 |
| Warning | `#d6b56c` | 风险、等待、部分可用 |
| Danger | `#e18484` | 错误、破坏性操作、断开异常 |
| Info | `#82b3d5` | 非危险提示；不能替代普通 accent |

状态不能只靠颜色表达。连接状态需要图标 / 文案，错误字段需要边框 + 错误文本，禁用态需要 opacity / cursor / aria 属性共同表达。

### 7.4 新增玻璃语义 token

新增 token 集中定义材质，组件不得各自硬编码 blur、alpha 和阴影：

```css
--glass-blur-chrome: 14px;
--glass-blur-overlay: 18px;
--glass-saturate: 112%;
--glass-highlight: rgba(255, 255, 255, 0.055);
--glass-border: var(--border-subtle);
--glass-shadow-overlay: 0 12px 32px rgba(0, 0, 0, 0.32);
--glass-fallback-bg: #151a21;
```

如需透明终端背景，另增 `--terminal-bg-rgb: 11 14 18` 或等价语义值，供 `rgb(var(--terminal-bg-rgb) / <alpha>)` 使用，消除 `App.tsx` 和 `terminalRegistry.ts` 里的重复字面色。

## 8. 环境底纹与玻璃规则

### 8.1 应用内部环境底纹

玻璃不能依赖用户配置终端壁纸才能被看见。允许在 `.app-shell` 的最底层增加非常弱的冷色环境光：

- 只使用 token 定义的两处低透明度 radial gradient，强度上限约 6%–8%。
- 不得形成可识别的彩色光球、紫色云雾或营销页渐变。
- 环境层不得响应鼠标，不得动画，不得覆盖终端内容。
- Zen 模式与减少透明度模式可以退化为纯色底板。

### 8.2 可使用玻璃的表面

| 表面 | 玻璃等级 | 备注 |
| --- | --- | --- |
| title bar / activity bar / sidebar | Chrome | 相邻分区仍以 1px 边界为主 |
| workspace tab strip / session toolbar | Chrome | 活动 tab 用细冰蓝指示，不填满蓝底 |
| right dock 与面板 header | Chrome | 内容滚动区保持近不透明 |
| Command Palette / context menu / select popover | Overlay | 统一高层材质 |
| Toast / Zen 退出条 | Overlay | 小面积轻阴影 |
| 设置、连接编辑与确认框 | Modal | 面板模糊；backdrop 只压暗 |
| detached workspace tab bar | Chrome | 与主窗口 token 一致 |

### 8.3 禁止使用玻璃的表面

- xterm 画布与 `.terminal-stage`。
- Monaco 编辑器正文与 gutter。
- SFTP / S3 / Remote Explorer 的长列表、树和表格滚动区。
- 每一行、每一张连接卡片、每一个按钮或输入框。
- 模态 backdrop；它不能和模态面板同时模糊。
- 嵌套在另一个玻璃表面内、没有独立层级意义的容器。

### 8.4 CSS 约束

- 玻璃规则集中在 `.is-glass-chrome`、`.is-glass-overlay`（或等价的少量共享选择器），不得复制到几十个组件。
- 同一路径最多出现两层 `backdrop-filter`，常规路径应只有一层。
- 必须同时写 `-webkit-backdrop-filter`，照顾 WKWebView。
- `@supports not (backdrop-filter: blur(1px))` 时使用 `--glass-fallback-bg` 的不透明表面。
- `@media (prefers-reduced-transparency: reduce)` 时关闭模糊与环境渐变，提高表面 alpha；该模式不得变成低对比半透明层。
- motion 仍遵循约 150ms 的颜色 / opacity 过渡，不为玻璃增加缩放、折射或流动动画。

## 9. 组件状态规范

| 状态 | 规范 |
| --- | --- |
| Default | 中性文字 / 图标；不使用 accent 装饰 |
| Hover | 中性白灰透明底，不默认变蓝 |
| Active / Selected | `--accent-soft` 背景 + 必要时细指示线；文字仍以 `--text-strong` 为主 |
| Keyboard focus | 1px–2px `--accent-border` / `--accent` outline，不能被 blur 或 overflow 裁掉 |
| Primary | 深冰蓝实底 + 白字，只给当前流程唯一主操作 |
| Disabled | 降低对比 + 禁止光标 / aria-disabled，不使用透明到不可辨识的方式 |
| Destructive | 使用 danger 边界 / 文案；确认按钮可使用 danger 实底，不使用 accent |
| Loading / Reconnecting | info 或 warning + 文案 / 图标，不能与 success 混淆 |

实施时需要重点审计 `global.css` 中所有 `color: var(--accent-strong)`。静态标题和普通 section icon 应改回 `--text-base` / `--text-muted`，只保留真正的交互语义。

## 10. 终端与编辑器

### 10.1 xterm

- `terminalTheme.ts` 改为冷黑背景与冰蓝光标，移除注释和选区里的 Nebula / violet 命名。
- 选区继续保持与 `--terminal-bg` 接近的明度，建议从 `#182630`（活动）与 `#121c24`（非活动）开始校准。
- ANSI 16 色保留红、绿、黄、蓝、洋红、青的区分；ANSI magenta 可以存在，它是终端协议语义色，不是界面品牌色。
- 终端背景、透明主题和 `--terminal-surface` 必须来自同一颜色源，不能保留 `rgba(20, 20, 28, …)`。
- 必须分别用 xterm WebGL 与 DOM fallback 目视检查选区字形，不得为追求更明显的蓝色选区重新引入字重错觉。

### 10.2 Monaco

- 内部主题名从 `dssh-violet-dark/light` 改为中性、稳定的 `dssh-graphite-dark/light`。
- 语法色降低紫色占比：keyword 使用冷灰蓝，string 使用低饱和青绿，number 使用柔和沙色，type 使用冰蓝。
- 编辑器背景保持不透明或近不透明，不应用 `backdrop-filter`。
- 光标、选区、当前行、查找匹配和 suggestion widget 都从 CSS 语义 token 读取。

## 11. 可访问性、性能与降级

### 11.1 对比度

- 普通正文与实际合成背景至少 4.5:1，大号文字至少 3:1。
- 控件边界、焦点、选中指示等非文本图形与相邻颜色至少 3:1。
- 所有透明表面需在“最亮环境底纹”和“最暗环境底纹”两个采样点测量。
- Placeholder、disabled 等豁免项仍需可辨识；不能用豁免作为降低全部次级文字对比度的理由。

### 11.2 性能门槛

- 不在终端 / 文件列表滚动容器上使用 filter。
- 玻璃只挂在尺寸稳定的 chrome 与浮层，避免每行产生新的合成层。
- 四分屏持续输出、SFTP 大目录滚动、窗口连续缩放时不得出现新增的明显掉帧。
- 若 Overlay 模糊导致低端设备出现稳定回退，优先降低 blur 半径或改为不透明 fallback，不牺牲输入响应。

### 11.3 兼容与回退

- 不支持 `backdrop-filter`：使用实色冷石墨层，层级仍靠明度和边框成立。
- 减少透明度：关闭 blur 和环境光，提升 chrome / overlay alpha。
- 用户终端壁纸：壁纸只受终端 opacity、磨砂开关和模糊度控制，不能透进侧栏或菜单；不支持背景模糊时不显示原图。
- 浅色模式：使用更高 alpha 和更弱模糊，避免背景杂色影响文字。
- 独立窗口：消费相同 `data-theme` 与 token，不维护第二套色值。

## 12. 文件影响范围

预期需要修改：

- `src/theme/global.css`：主题 token、材质 token、环境层、共享玻璃规则、组件 accent 使用审计。
- `src/terminal/terminalTheme.ts`：xterm 调色板。
- `src/terminal/terminalRegistry.ts`：透明终端背景的颜色来源。
- `src/app/App.tsx`：`--terminal-surface` 的动态 alpha 颜色来源。
- `src/sftp/monacoLoader.ts`：主题名与语义颜色校准。
- `README.md`、`spec.md`、`AGENTS.md`：当前视觉身份。
- `features/liquid-glass.md`、`TODO.md`、`tasks.md`：删除或重写与本规格冲突的 CSS overlay 规划，只保留原生窗口材质后续项。
- 其他仍出现 Violet / Nebula 文案的 feature 文档：改成“Graphite Glass 语义 token”或中性的“全局主题 token”。

本规格不应修改：

- `src-tauri/tauri.conf.json`、`src-tauri/tauri.macos.conf.json`。
- Rust command、window effect、capability 或 migration。
- 组件 DOM 排版、ActivityId / RightPanelId、pane tree 与 detached lifecycle。

## 13. 验收矩阵

至少覆盖以下组合：

| 维度 | 组合 |
| --- | --- |
| 平台 | macOS、Windows 11；Windows 10 至少验证实色 fallback |
| 主题 | dark、light、system 随系统切换 |
| 窗口 | 主窗口、detached terminal、detached SFTP；普通 / 最大化 / Zen |
| 工作区 | 连接管理、单终端、四分屏、SFTP、S3、Remote Explorer、AI、Host Tools |
| 浮层 | Command Palette、设置、连接编辑、右键菜单、SelectMenu、Toast、确认框 |
| 终端 | WebGL、DOM fallback、100% 背景、半透明、带壁纸、选区 |
| 辅助功能 | 键盘导航、减少透明度、高 DPI、跟随系统主题 |

## 14. 发布验收标准

全部满足后才视为完成：

1. 默认深色界面和浅色界面均无 Violet / Nebula 品牌紫色残留；ANSI magenta 与用户内容不计。
2. 主界面不依赖桌面透明或终端壁纸，也能看出克制的玻璃层级。
3. 活动、hover、focus、selected、disabled、danger、reconnecting 状态可区分且语义正确。
4. 正文、次级文字、焦点与控件边界通过对比度审计。
5. 终端选区在 WebGL 下没有明显字重变化，ANSI 颜色可区分。
6. `prefers-reduced-transparency` 和不支持 blur 的 fallback 均可用。
7. 主窗口与 detached 窗口主题一致，切换 system / dark / light 后同步正确。
8. 没有修改布局密度、交互模型、Tauri 窗口透明或 Rust 后端。
9. `pnpm exec tsc --noEmit` 与 `pnpm build` 通过；视觉矩阵在 `pnpm tauri dev` 或打包产物中完成记录。

## 15. 决策记录

| 决策 | 结果 | 原因 |
| --- | --- | --- |
| 是否直接把紫色替换为亮蓝 | 否 | 仍会产生高饱和“科技 / AI”气质，且没有解决强调色滥用 |
| 是否删除浅色主题 | 否 | 保留现有 system / light / dark 契约，降低迁移风险 |
| 是否让终端本体玻璃化 | 否 | 文字保真、WebGL 合成和持续输出性能优先 |
| 是否本次启用桌面透视 | 否 | 属于 Tauri 原生窗口材质，平台风险和发布验证不同 |
| 是否新增主题设置 | 否 | 本次是默认视觉替换，不增加产品选项 |
| 是否允许少量 ANSI 洋红 | 是 | ANSI 是终端内容语义，不是应用品牌色 |
| 是否复制参考图布局 / 壁纸 | 否 | 用户明确只参考配色主题 |
