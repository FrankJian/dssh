# 终端多配色方案与自定义颜色

> 状态：首轮实现已落地；真实终端视觉与跨平台验收待完成（2026-10-15）。
> 实施记录与验收进度见 [tasks.md](../tasks.md#终端多配色方案与自定义颜色)。

## 1. 目标与研究结论

在“设置 → 终端”选择预设配色，或复制预设并修改文字、背景、光标、选区及 ANSI 颜色，保存为自己的方案。切换即时生效，无需重新连接 SSH。默认跟随应用外观：浅色应用使用浅色终端方案，深色应用使用深色终端方案；每种外观可分别选择其对应方案。方案适用于 SSH、本地 shell、欢迎终端、分屏和独立窗口。

当前实现可以扩展，不需要更换终端库，也不需要修改 SSH 协议、数据库或连接配置：

| 现有位置 | 现状 | 实施影响 |
| --- | --- | --- |
| `src/terminal/terminalTheme.ts` | 单套 Graphite `ITheme` | 拆分预设数据、类型和解析函数，保留原配色 |
| `src/terminal/terminalRegistry.ts` | 每窗口持有长期存活的 xterm；透明主题是静态常量 | 给存活实例增加统一配色更新入口，包括未挂载实例 |
| `src/terminal/TerminalView.tsx` | 不透明度变化时调用 `applyTransparentTheme()` | 消除重新覆盖为固定 Graphite 的路径 |
| `src/app/App.tsx`、`src/theme/global.css` | CSS 独立绘制背景，不透明度依赖 `--terminal-bg-rgb` | xterm 和 CSS 必须应用同一个解析结果 |
| `src/settings/useTerminalSettings.ts` | 字体等设置分别写入 localStorage | 新配色使用独立、带版本的 store，不扩大为全部设置重构 |
| `src/app/DetachedWorkspace.tsx` | 独立 renderer 和 registry | 共享初始化和订阅逻辑，不能只改主窗口 |
| `src/theme/useTheme.ts` | 应用主题支持 system/light/dark | 监听解析后的 `data-theme`，在跟随模式下切换对应终端方案 |

安装版本的 `@xterm/xterm` 6.x 类型已提供 `foreground`、`background`、光标、选区、16 ANSI 色和 `extendedAnsi`。主题可以通过 `terminal.options.theme` 更新；接口依据：[ITheme](https://xtermjs.org/docs/api/terminal/interfaces/itheme/) 与 [Terminal.options](https://xtermjs.org/docs/api/terminal/classes/terminal/)。实施以锁文件对应的本地类型和行为测试为准。

## 2. 首版范围

- 十二套内置方案、浅色/深色标识、默认随应用外观切换，并可分别保存浅色与深色方案。
- 自定义方案：复制、新建副本、编辑、重命名、删除；颜色输入和静态终端预览。
- 所有已存在与后续创建的终端同步更新，不重建 xterm，不重连，不清屏，不重新播放历史输出。
- 默认仍是当前 Graphite Dark；升级不改变原有字体、字号、行高、字间距、GPU、壁纸和透明度。
- 不改变应用 chrome、Monaco、SFTP 或 S3 的配色。

首版不包括：按主机/标签设置主题、主题市场、网络下载、配置导入导出、云同步、全部 256 色编辑。后续可以扩展，但不作为首版依赖。

## 3. 预设目录

| 稳定 ID | 名称 | 类型 | 设计基准 |
| --- | --- | --- | --- |
| `builtin:graphite-dark` | Graphite Dark | 深色、默认 | 完整保留当前 `terminalTheme.ts`，包括低对比选区 |
| `builtin:graphite-light` | Graphite Light | 浅色 | 项目自有；雾白底、深石墨文字、冰蓝光标 |
| `builtin:graphite-contrast` | Graphite Contrast | 深色、高对比 | 项目自有；强调文字可读性，选区仍需单独验证 |
| `builtin:nord` | Nord | 深色 | 基于 Nord 官方调色板，记录终端字段映射 |
| `builtin:solarized-dark` | Solarized Dark | 深色 | 基于 Solarized 官方终端深色映射 |
| `builtin:solarized-light` | Solarized Light | 浅色 | 基于 Solarized 官方终端浅色映射 |
| `builtin:catppuccin-mocha` | Catppuccin Mocha | 深色 | Catppuccin 官方 Kitty 终端映射；Ghostty 文档推荐示例的同一主题系列 |
| `builtin:catppuccin-latte` | Catppuccin Latte | 浅色 | Catppuccin 官方 Kitty 终端映射，可与 Mocha 成对跟随外观 |
| `builtin:tokyo-night` | Tokyo Night | 深色 | TokyoNight 官方 Alacritty 终端映射 |
| `builtin:tokyo-night-day` | Tokyo Night Day | 浅色 | TokyoNight 官方 Alacritty 终端映射，可与 Tokyo Night 成对跟随外观 |
| `builtin:gruvbox-dark` | Gruvbox Dark | 深色 | Gruvbox 官方 medium-contrast 终端映射；Tabby 提供 Gruvbox 主题 |
| `builtin:gruvbox-light` | Gruvbox Light | 浅色 | Gruvbox 官方 medium-contrast 终端映射，可与 Dark 成对跟随外观 |

每套必须显式定义默认文字、背景、光标、块光标文字、活动/非活动选区和全部 16 ANSI 色，不依赖 xterm 隐式默认色。选中文字默认保留原色。Graphite Light 与 Contrast 的完整数值在第一阶段视觉校准后冻结为数据及快照；不能仅换背景而复用不适合浅底的 ANSI 色。

Nord、Solarized、Catppuccin、Tokyo Night 和 Gruvbox 的基础色均来自其官方项目；Ghostty 将 iTerm2 主题库作为内置主题来源，Tabby 也提供 Gruvbox 与 Catppuccin 等社区主题。颜色映射与项目自行适配的光标/选区已记录在 [`NOTICE.md`](../src/terminal/themes/NOTICE.md)。运行时不联网获取主题。

## 4. 设置与交互

### 4.1 方案选择

“设置 → 终端”增加“配色方案”，与原有字体设置相邻。默认勾选“跟随应用外观”：应用为浅色时只显示浅色方案，为深色时只显示深色方案，分别记住每种外观的选择；切换应用主题会立即切换终端至相应方案。用户可关闭该选项以固定一个配色，此时允许选择不同明暗的方案，并明确提示它可能与应用外观不一致。使用紧凑分组下拉菜单（内置、自定义），展示名称、深浅类型和小色样；不新增大卡片或独立工作区。

选择即提交，更新所有终端。关闭设置不会撤销已选择的方案；与下面明确标识的编辑草稿区分。提供“恢复默认配色”，只选择 Graphite Dark，不删除自定义方案，不重置字体或背景图片。

### 4.2 自定义编辑

- 内置方案不可覆盖或删除；“复制并编辑”创建草稿，保存时生成 `custom:<uuid>`。复制自定义方案也产生新 ID。
- 编辑器包含名称、基础颜色、可折叠的 ANSI 16 色、预览，以及“保存并应用”“取消”。颜色更改仅影响预览，不污染当前会话或持久化数据。
- 保存现有自定义方案时保留 ID；保存成功后激活它。保存失败保留草稿并显示错误，不谎报成功。
- 名称去除首尾空格后为 1–40 个 Unicode 字符；拒绝控制字符；大小写不敏感的重名拒绝，默认副本名自动编号。
- 编辑期间切换方案、关闭编辑器或按 Esc：有未保存修改时确认丢弃；取消确认则留在草稿。无修改直接关闭。
- 支持逐字段恢复到“创建该自定义方案时的基础快照”，以及确认后整套恢复。不能随预设升级改变此基准。
- 删除仅对自定义开放，需确认。删除当前方案时在同一次提交中回退 Graphite Dark。删除非当前方案不改变当前选择。

### 4.3 可编辑字段及输入约束

| UI 字段 | 数据字段 | 语义 |
| --- | --- | --- |
| 默认文字颜色 | `foreground` | 未显式指定颜色的普通文字 |
| 背景颜色 | `background` | 终端基础底色；透明度仍由现有设置控制 |
| 光标颜色 / 块光标文字 | `cursor` / `cursorAccent` | 不改变光标形状；后者仅块光标明显可见 |
| 选区 / 非活动选区背景 | `selectionBackground` / `selectionInactiveBackground` | 分别用于聚焦和失焦状态 |
| 选中文字 | `selectionForeground` | “保留原色”为 null；也可指定颜色 |
| 标准与明亮 ANSI 色 | `black`…`white`、`brightBlack`…`brightWhite` | 对应索引 0–15，每个色样有名称和索引 |

颜色选择器和 HEX 文本框双向联动，只保存规范化的 `#RRGGBB`；允许输入 `#RGB` 并展开。无效/未完成输入保留在草稿输入框，显示错误并禁止保存，不能传给 xterm/CSS。首版不接受 CSS 表达式、变量、URL、任意命名色或 alpha；背景 alpha 继续使用现有控件。

提示用户：修改默认文字颜色不等于给全部输出重新染色。程序使用的 ANSI 0–15 随对应调色板改变；索引 16–255 保持 xterm 默认扩展色；程序显式指定的 RGB 真彩色不被强行覆盖。Vim/tmux 等程序自身主题可能仍需在程序内调整。

提供非阻塞可读性提醒：按不透明基础底色计算普通前景对比度，低于 4.5:1 时提示但允许保存；说明透明背景/壁纸下实际对比会变化，不宣称整套终端达到无障碍标准。色样之外必须有文本名称、值、键盘操作和可见焦点。

### 4.4 预览

单个隔离、只读 xterm 展示固定本地样例：中英文、数字、普通/粗体、16 色前景和背景、灰阶/真彩色示例、光标及文本选区。使用当前字体参数，允许拖选但不接收终端输入、不调用后端、不创建 SSH 会话。预览基础底色保持不透明，并明确提示实际终端透明度另由背景设置控制。

预览默认使用非 WebGL 渲染路径，避免为编辑器额外占用 GPU context；关闭时销毁 terminal、addon 和监听器。真实终端的 WebGL 视觉一致性另行验收，不用预览代替。

## 5. 数据与持久化

建议增加 `src/terminal/themes/{types,presets,resolve}.ts`、`src/settings/terminalThemeStore.ts` 和薄 React 订阅 hook。字段白名单独立于任意 `ITheme` 对象，避免把未来渲染器字段直接写入用户配置。

```ts
interface TerminalThemePreferencesV1 {
  schemaVersion: 1;
  revision: number;
  activeSchemeId: string;             // 关闭“跟随应用外观”时的固定选择
  followAppearance: boolean;          // 新记录默认为 true
  darkSchemeId: string;               // 深色应用对应方案
  lightSchemeId: string;              // 浅色应用对应方案
  customSchemes: Array<{
    id: string;                     // custom:<uuid>
    name: string;
    kind: "dark" | "light";         // 用于分组提示，不控制应用主题
    sourcePresetId: string;         // 来源信息，不作为运行时继承依赖
    baseColors: TerminalColors;     // 创建副本时的完整基础快照
    colors: TerminalColors;         // 完整的当前值；包含 nullable selectionForeground
  }>;
}
```

`TerminalColors` 为第 4.3 节字段的精确类型；除 `selectionForeground` 外必填。`kind` 在编辑器可选；复制时继承。内置数据不重复写入存储。复制自定义方案时，以被复制方案当时的完整颜色作为新的 baseColors。

- 使用新 key `dssh.terminal.colorSchemes`，不修改既有字体等 key。缺失时在内存使用 Graphite Dark，首次真实提交才写入，不在挂载时无条件写默认值。
- 解析必须捕获 JSON、存储访问和配额错误；限制自定义方案最多 100 套、记录最大 256 KiB，过滤未知字段，不执行外部内容。
- 对 schema、ID 唯一性、名称、完整颜色和引用进行验证。无效已知版本记录回退到内存默认，保留原始存储；提示用户并在显式确认重置后才覆盖，避免静默丢失自定义方案。有效记录仅 active ID 失效时可在内存回退默认，下次提交修正。
- 未知更高 schema 版本只读并提示版本不兼容，不降级覆盖；未来变更通过显式版本迁移函数完成。
- 新 store 是此设置的唯一写入口；同窗口发布订阅，跨窗口监听 storage 变化并重新读取权威值，订阅处理不得再次写入以免循环。在真实 Tauri Windows/macOS 验证事件传播，若不可靠，增加 Tauri 无敏感数据的“设置已变更”事件作为失效通知，接收方仍重新读取存储。
- 首版编辑入口仅主窗口设置，独立窗口只读订阅，避免引入多写者事务。revision 用于编辑冲突检测，不假装 localStorage 支持 CAS；保存前发现版本变化时要求重新加载或另存副本，不静默覆盖。未来开放多窗口编辑必须重新设计并发控制。

## 6. 渲染与生命周期

解析链路为：已验证配置 → 选中方案完整颜色 → xterm ITheme 与 CSS 背景 token。主题数据允许颜色字面值；UI 组件仍只引用语义 token。

1. 窗口启动先读配色 store，再创建首个终端，避免先闪默认深色。欢迎终端走同一路径。
2. 每个窗口的 registry 订阅解析结果并遍历存活实例，包括未挂载/隐藏标签；新实例从 store 获取最新值。相同有效颜色不重复应用。
3. 增加统一 `applyTheme`，每次赋新的完整 `terminal.options.theme`，不原地修改旧对象；从指定选中文字切回 null 时必须清除旧 override，增加回归测试。
4. 不透明实例使用方案 background；透明实例仅把 xterm background 设为透明，其余字段来自同一方案。替换静态 `transparentTerminalTheme`，透明度回调不得恢复固定 Graphite。
5. 在主窗口与独立窗口复用背景应用逻辑，同步更新 `--terminal-bg`、`--terminal-bg-rgb` 及原有 `--terminal-surface`。只作用终端背景，不修改全局应用底色；padding 与画布不能出现两种颜色。
6. 配色切换不修改透明模式、尺寸、字体、session ID 或 registry key；不调用 acquire/release、reset、clear、fit、PTY resize 或 reconnect。现有透明模式切换的生命周期行为不在本次重构范围内，但必须正确保留选定配色。
7. GPU 开关/上下文恢复、标签重新挂载、分屏与独立窗口迁移后使用当前配色。迁移后的初始化不能从旧 snapshot 恢复成固定主题。

远端 OSC 改色保留现有 xterm 兼容行为，只属于该会话的临时渲染状态，不反写设置。用户显式切换/应用配色后以用户方案为准；同一方案下的无关 UI render 不反复重置远端颜色。针对 OSC 4/10/11 及恢复序列补充行为测试；若当前库的重置语义与目标不符，在实现记录中明确适配，不为换主题清空终端。

## 7. 验收与测试

| 类别 | 必须验证的结果 |
| --- | --- |
| 兼容升级 | 无新 key 时与原 Graphite 逐字段相同；已有字体、背景设置不变 |
| 十二套预设 | 基础色与 16 ANSI 均完整；深浅背景、光标、选区可读；第三方来源可追溯 |
| 编辑闭环 | 新建/复制/编辑/重命名/重置/删除/取消正确；重启后名称与颜色一致 |
| 颜色边界 | 非法 HEX 不生效；null 选中文字清除前值；真彩色不被默认文字设置覆盖 |
| 背景 | 0/50/100% 不透明度、壁纸开关、磨砂开关下画布与边缘一致，文字不随背景变透明 |
| 生命周期 | 当前/隐藏标签、四格分屏、欢迎页、两个独立窗口均更新；切换期间 scrollback、选区、滚动位置、输入和 Vim alternate screen 不丢失 |
| 跨窗口 | 主窗口选择与删除当前方案立即传播；新开独立窗口读最新值；无事件写回循环或旧状态覆盖 |
| 健壮性 | 损坏 JSON、未知版本、缺字段、重复 ID、容量/权限错误、编辑冲突不崩溃或静默丢数据 |
| 渲染 | macOS/Windows，GPU 开/关及上下文丢失回退；特别检查选区字重观感、中英文、粗体、细线和浅色 ANSI |
| 资源/性能 | 连续切换 100 次与反复开关编辑器，无 terminal/listener/context 持续增长；无 SSH 重连或额外 PTY resize |

首轮已增加 Node 24 原生测试入口 `pnpm test:terminal-themes`，覆盖十二套预设完整性、Graphite 兼容、HEX 边界、透明主题解析、自定义方案保存/删除及无效数据保留。registry 生命周期、冲突和跨窗口传播仍需补充自动覆盖或人工验收；真实 GPU 和 Tauri 多窗口必须实机验证。

发布门槛：自动测试、`pnpm exec tsc --noEmit`、`pnpm build` 通过，`pnpm tauri dev` 完成双平台矩阵并记录证据。预计不涉及 Rust；若同步方案确需 Rust 变更，再执行 Rust fmt、严格 clippy 和 cargo test。未完成真实平台验收的项目不能勾选为通过。
