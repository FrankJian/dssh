# Proposal

## Why

Duo SSH 已有嵌入 SFTP 的 Monaco 文本编辑、本地文件读写和远程文件树，但缺少统一、独立的项目编辑工作台。用户需要基于 `@monaco-editor/react`、尽量遵循 VS Code 操作习惯的完整核心编辑体验，连续完成本地与远程目录浏览、编辑、搜索、比较和安全保存。

## What Changes

- 新增独立编辑器工作区，支持无需 SSH 的本地文件/文件夹，以及经既有 SSH/SFTP 授权访问的远程目录；接入主窗口和独立工作台，与终端、SFTP、浏览器切换时保留编辑状态。
- 左侧导航提供直接打开文本编辑器的入口，设置中控制显示；保留已有用户导航选择。无需连接即可新建文本、选择本地文件或目录，独立窗口提供相同入口。
- 参考 VS Code 的 Explorer、文件标签、预览标签/固定标签、编辑器分组、水平/垂直分屏、面包屑、状态栏、快捷打开与命令交互；外观遵守 Duo SSH 设计规范。
- 完整文件树：懒加载、刷新、隐藏文件、定位活动文件、键盘导航、多选，以及创建、重命名、移动、复制、删除、复制路径；复用现有文件操作保护，不改变 SFTP 双栏传输语义。
- 编辑能力：撤销/重做、多光标、列选择、行操作、注释、缩进、折叠、括号配对、查找替换、行/符号跳转、高亮、片段、可用语言补全/诊断/格式化、问题列表、Markdown/图片预览与差异比较。
- 增加目录内容搜索/替换、包含/排除规则、结果定位、取消与部分失败展示；批量落盘替换先预览、显式确认并逐文件检查冲突。
- 完善新建未命名文本、保存、全部保存、另存为、重新加载、只读状态、外部变更检测、冲突比较与关闭保护；明确 UTF-8/BOM、UTF-16 LE/BE 和 GB18030 编码及 LF/CRLF 行尾行为。
- 将现有命令式 Monaco 外壳迁移到 `@monaco-editor/react` 的 Editor/DiffEditor，保留本地 ESM/worker、懒加载、语义主题、模型隔离和离线运行。
- 本次所有阶段均属于核心交付；不纳入 Git、调试器、扩展市场、远端 LSP、任务运行器、多根目录混合工作区或 AI 自动改写。默认继续仅显式保存，不悄然加入自动保存或磁盘草稿。

## Capabilities

### New Capabilities

- `editor-workspace`：本地/远程编辑工作区、文件树、文件与分组导航、核心编辑命令、内容搜索替换、预览与比较。

### Modified Capabilities

- `remote-editor`：扩展 Monaco 外壳、模型共享与实例隔离、读写版本检查、编码行尾和保存失败边界，兼容原有 SFTP 入口。
- `workspace-layout`：新增编辑器标签与独立窗口的状态保留和生命周期保护。
- `keyboard-shortcuts`：新增编辑器命令与上下文路由，保留既有自定义和终端按键语义。

## Impact

- 前端：新增 `src/editor/` 模块；接入 `src/app/App.tsx`、`useWorkspace`、`WorkspaceTabStrip`、命令面板/快捷键与移窗状态；适配 `src/sftp/RemoteFileEditor.tsx`、`MonacoRemoteEditor.tsx` 和 `monacoLoader.ts`，复用文件树/服务/预览与共享 UI。
- 依赖：新增 `@monaco-editor/react`，继续使用本地 `monaco-editor`；实施时锁定与 React 19、现有 Monaco/Vite 配套版本，并验证离线打包。不引入 VS Code Workbench。
- Rust：在现有本地文件操作和 `SftpManager` 边界内提供版本元数据、编码读写、内容搜索和受保护保存；同步 DTO/TypeScript/service 的 camelCase 契约。默认不调用远端 shell，不扩大 JumpServer 权限。
- 数据：新增独立本机编辑偏好与工作区元数据，不改连接配置、导入导出或旧存储键；不持久化正文、秘密或未保存草稿。若确需数据库结构变化，使用编号迁移。
- 验证：新增编辑状态/搜索/保存回归，保留 SFTP、快捷键、工作区和代码图片工具回归；真实 SSH 与 macOS/Windows 安装包单独验收。实际实施进度以任务文件为准，验证证据与未完成范围见 `docs/verification/editor-workspace.md`。
