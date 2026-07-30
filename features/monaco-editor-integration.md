# Monaco 远程代码编辑器规格

> 状态：基础实现已完成，待 macOS / Windows 打包产物人工验收。本文定义以 Monaco 升级远程文本编辑体验的边界与实施约束；目录树、远程文件操作与图片 / Markdown 预览不属于 Monaco 的职责。

## 1. 目标与非目标

### 目标

- 在现有远程文件编辑器中提供代码高亮、行号、折叠、查找替换、括号匹配与多光标编辑。
- 保持现有 SFTP 读写、主机密钥 TOFU、文件标签、未保存状态、保存确认和 1 GiB 文本限制。
- 按需加载编辑器与语言 worker，不拖慢 SSH 管理主界面的首次加载。
- 让深 / 浅色主题与 Violet / Nebula 语义 token 一致。

### 非目标

- 不引入 VS Code Workbench；不以 Monaco 替换 `RemoteFileTree`、上传、下载、创建、删除或重命名功能。
- 不自动提供远端 LSP、Git、调试器、任务运行器、VS Code 扩展或完整项目工作区。
- 不替换图片预览、Markdown 预览及其可拖拽分栏。

## 2. 架构边界

```
RemoteFileTree ── sftp_list / 上传下载 / 文件操作 ── Rust SftpManager
       │
       └─ 打开文本文件 ── RemoteFileEditor ── Monaco Editor model
                                 │                    │
                         sftp_read_text       dssh-sftp://<profile>/<path>
                         sftp_write_text      内容、光标与视图状态
```

- `RemoteFileTree` 仍负责远端路径、懒加载树以及所有文件管理操作。
- `RemoteFileEditor` 继续管理文件标签、活跃文件、保存 / 放弃确认和图片 / Markdown 分支；只有普通文本分支内部的 `textarea` 替换为 Monaco。
- Rust 侧继续通过既有 `SftpManager` 读写；编辑器不得直接连接 SSH 或绕开 TOFU 校验。

## 3. Monaco 模型生命周期

1. 文件首次打开时，先经 `sftp_read_text` 获得 UTF-8 文本，再创建唯一 model：`dssh-sftp://<profileId>/<absolute-path>`。
2. model 内容变更通过 `onDidChangeModelContent` 更新现有 dirty 状态；禁止每个按键都写入远端。
3. 点击保存或 ⌘/Ctrl+S 时调用 `sftp_write_text`；成功后更新 saved snapshot，失败时保留 model 内容并显示错误。
4. 关闭标签时，沿用“保存并关闭 / 放弃修改 / 取消”确认；完成后 dispose model 和监听器。
5. 断开会话、切换 profile 或销毁编辑器时 dispose 全部该 profile 的 model / editor / subscription，避免 URI 冲突和内存泄漏。

## 4. 集成约束

- 使用 `monaco-editor` 官方 ESM 构建，不接入已废弃的 AMD 集成方式。
- 通过 Vite worker URL 配置 MonacoEnvironment；编辑器及 worker 均动态导入。
- `tauri dev` 与 macOS / Windows 打包产物都必须实测语法 worker、TypeScript worker、查找替换和主题切换。不能假定开发服务器正常即代表打包的 WebView worker 正常。
- 主题由 `monaco.editor.defineTheme()` 映射 CSS semantic token；不依赖 Monaco 内部 CSS class 覆盖。
- 默认仅启用常见语言和必要 worker；最小化首包、内存与 worker 数量。大型文件仍受后端 1 GiB 限制。

## 5. 语言与智能能力边界

- Monaco 内置的高亮、编辑命令及浏览器端 JavaScript / TypeScript、JSON、HTML、CSS 能力可直接受益。
- 文件扩展名必须映射到 Monaco language id；未知扩展名降级为 plaintext。
- 跨文件跳转、远端依赖解析、Go / Rust / Python 补全与诊断需要额外的语言服务器设计：远端命令、LSP 传输、生命周期、权限、资源限制和显式用户授权均需另立规格。

## 6. 实施阶段

1. **基础替换**：Monaco 懒加载、model URI、语言映射、保存 / dirty / dispose、深浅主题。
2. **编辑体验**：查找替换、格式化配置、编辑器设置（字体、minimap、自动换行）及可访问性验证。
3. **可选智能能力**：以单语言、小范围真实主机验证的方式评估 LSP；未通过安全与资源评审不进入正式功能。

### 当前实现记录

- 已完成阶段 1：`MonacoRemoteEditor` 仅在成功读取首个文本文件后加载 Monaco；每个 model 使用 `dssh-sftp://<profileId>/<absolute-path>` URI，并在标签关闭、profile 切换或编辑器销毁时释放 model 和订阅。
- 已完成阶段 2 的基础编辑体验：语言映射与手动语言覆盖、行号、折叠、括号配对、查找替换、多光标、自动换行、无 minimap、⌘/Ctrl+S 保存和辅助功能支持。格式化能力仅由 Monaco 内置语言服务提供；远端 LSP 仍不在范围内。
- Monaco core 使用动态导入；Vite 8 会将 worker 作为独立资源输出，实际仅在 Monaco 请求对应语言 worker 时创建。为兼容其 Rolldown 对第三方 deep `?worker` 导入的解析限制，worker 引用使用项目内解析的官方 ESM 文件路径。
- 尚需按第 7 节在 macOS 与 Windows 的开发/打包 WebView 中人工验证 worker、中文输入法、主题切换和无障碍操作。

## 7. 验收与验证

- 打开、切换、保存、放弃关闭多个远端文本文件；确认无内容丢失、无重复 model、无残留 worker 错误。
- Markdown / 图片继续走现有预览路径，目录树上传下载不回归。
- 在 macOS、Windows 的开发与打包环境验证 worker 加载、深浅主题、中文输入法、⌘/Ctrl+S、屏幕阅读器基本操作。
- 运行 `pnpm exec tsc --noEmit`、`pnpm build`；若改动 Tauri / SFTP 接口，补跑 Rust 全套验证。

## 8. 决策记录

采用“Monaco 仅替换编辑器”的方案。Monaco 是浏览器代码编辑器，不是 VS Code Explorer 或完整 Workbench；保留 Duo SSH 已有 SFTP 功能可避免把远端文件权限、TOFU、传输进度和错误处理迁移到不合适的 UI 库中。
