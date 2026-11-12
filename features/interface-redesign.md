# 界面重设计方向：柔和几何与整体配色

> 状态：后续页面重设计的设计要求；当前实现仍以 Graphite Glass 为基线。本文不表示页面或主题切换功能已经实现。
> 适用范围：主工作台、连接管理、设置、SFTP / S3、助手、主机工具、弹窗与独立窗口。终端 ANSI 配色另见 [`terminal-color-schemes.md`](terminal-color-schemes.md)。

## 目标

- 整体更精致、柔和、有层次，减少大块平直矩形拼接和沉闷的冷黑底色。
- 保留 SSH 管理器的专业效率：连接状态清楚，终端与文件内容优先，常用动作易发现，键盘操作完整。
- 未来支持**整个应用的配色方案**切换。它改变背景、表面、边界、文字层级、焦点和主操作的配色关系，不只是替换一个强调色；深色 / 浅色 / 跟随系统仍是独立维度。

## 布局与形状

- 保留工作台的主要导航和功能关系，但允许重新组织页面内部布局、间距与视觉层级；不把现有 `48px` 活动栏、`36px` 标签条等尺寸视为永久标准。
- 页面底板、侧栏、标签条、工具栏、表单区和浮层采用一致的柔和曲线。先定义语义半径层级，再按控件尺寸与嵌套关系使用；内层半径应小于外层，留出均匀的内边距。不要把所有东西做成同一种胶囊形。
- 使用留白、表面明度和少量边界建立分组。减少“一个功能一个矩形框”的卡片堆叠；连接列表、树和表格仍可保持紧凑、易扫描。
- 顶部导航、活动状态、侧栏选中态、按钮与输入框应共享形状语言。标签与分屏边界须清楚，圆角不能截断焦点环、滚动条或内容。
- 大窗口可通过更宽的边距与分栏增加呼吸感；窄窗口优先保留操作和信息顺序，不靠挤小字号维持布局。

## 配色模型

- 当前 Graphite Glass 是**现状**，不再作为未来重设计唯一允许的配色。新方案优先探索中性、低噪声、有温度的底色，并用少量协调的色相营造辨识度；避免整屏近黑、灰泥感、大面积高饱和或俗艳渐变。
- 主题模型预留三个彼此独立的轴：`appearance = light | dark | system`、`appPalette = 预设 ID`、`terminalScheme = 终端方案 ID`。当前功能尚未提供 `appPalette` 选择器，实施时保持已有设置和用户偏好兼容。
- 每套应用配色提供深浅两组语义 token：画布、导航、普通 / 凹陷 / 浮起表面、文字层级、边界、交互强调、选中、焦点、主按钮、玻璃 tint 与不透明 fallback。成功 / 警告 / 错误仍保持可识别的业务语义。
- 初版配色建议先验证少量完整方案，而非让用户逐项调色：例如温润中性、蓝灰、低饱和松绿或紫灰。名称与具体色值以真实界面视觉测试确定，不把示例当作已定稿色板。
- 组件只引用语义 token；禁止在页面内按配色 ID 写局部覆盖。切换配色时，主窗口、独立窗口、设置、菜单、弹窗和 Monaco 外壳同步更新；终端内容色由终端方案控制。

## 玻璃与层次

- 应用内轻玻璃可用于稳定的导航 chrome、命令面板、菜单和少量浮层。用透明度、适度模糊、柔和边缘与背景 tint 建立层次，不追求夸张折射、强高光或连续动效。
- 终端、Monaco 正文、远程桌面、长列表 / 树 / 表格与高频滚动区保持不透明或近不透明。浮层文字必须在实际合成背景上可读。
- 减少透明度、系统高对比或不支持 `backdrop-filter` 时使用实色表面；原生窗口透出桌面的可选能力仍按 [`liquid-glass.md`](liquid-glass.md) 单独评估。

## 交互与验收

- 用文字、图标、形状或位置共同表达连接、错误、禁用和选中状态；焦点清晰，键盘导航和屏幕阅读器名称完整。
- 正文与重要控件按 WCAG 2.2 AA 对比度检查；半透明表面按最不利的实际合成结果检查。保留终端 WebGL 选区的特殊校准约束。
- 动效只服务于状态变化，尊重减少动态效果设置；玻璃和配色切换不得带来终端滚动、窗口缩放和分屏的可感知性能回退。
- 每个重设计页面至少检查：深色 / 浅色、不同应用配色、窄 / 宽窗口、主 / 独立窗口、减少透明度与键盘焦点。先做页面级视觉验证，再扩展到全应用一致性。

## 与既有文档的关系

- [`.cursor/rules/design.mdc`](../.cursor/rules/design.mdc) 是日常 UI 实施规则；[`spec.md`](../spec.md) 记录当前界面与后续方向。
- [`graphite-glass-theme.md`](graphite-glass-theme.md) 与 [`graphite-glass-theme-tasks.md`](graphite-glass-theme-tasks.md) 记录上一轮主题实施、色值和验收，不再约束未来页面必须保持冷黑 / 冰蓝或小圆角。
- [`liquid-glass.md`](liquid-glass.md) 只负责原生窗口材质规划，不能代替应用配色与布局重设计。

## 参考依据

- [Apple Human Interface Guidelines — Materials](https://developer.apple.com/design/human-interface-guidelines/materials)：将玻璃用于导航与控制层，内容层优先保持清晰，并考虑可读性与透明度设置。
- [Apple Human Interface Guidelines — Color](https://developer.apple.com/design/human-interface-guidelines/color)：颜色要在不同外观和对比度环境下成立，状态不能只靠颜色传达。
- [Microsoft Windows 11 Geometry](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry)：递进的圆角、嵌套元素和一致的间距形成柔和、连贯的界面。
- [Microsoft Fluent 2 Design Tokens](https://fluent2.microsoft.design/design-tokens/)：以语义 token 管理颜色、间距、圆角等，支撑系统性换肤。
- [Microsoft Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)：桌面背景材质应服务于层级与性能，不能靠透明效果承担全部视觉设计。
