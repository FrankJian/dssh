# 工具箱模块加载恢复验证

2026-11-27。任务以 [fix-tool-module-loading](../../openspec/changes/fix-tool-module-loading/tasks.md) 为准。

用户报告点击工具箱进入全局错误页，错误为 `Importing a module script failed.`，随后确认重启恢复。事后对运行中的本机 Vite JSON 格式化入口、React 与 JSON/YAML 模块请求得到 HTTP 200。没有捕获原始失败请求或 WebView 堆栈，不能确认缓存、网络或其他具体根因，也不能把重启恢复等同于根因修复。

本次加固：所有工具 lazy 入口接入独立错误边界，显示中文反馈并支持重新创建 lazy 实例后再次加载；不刷新整个 App。SSR 侧栏回归使用临时缓存并在关闭时清理；浏览器回归使用 `tools-qa`、`sidebar-qa`、`editor-qa` 模式隔离缓存。已用 Vite `resolveConfig` 确认日常开发和 tools-qa 的实际 cacheDir 不同；没有删除日常开发缓存。

## 已验证

- 类型检查和生产构建通过；构建仍有部分 chunk 大于 500 kB 的提示。
- `pnpm --config.verify-deps-before-run=false test:tools`：45/45 通过。
- `pnpm --config.verify-deps-before-run=false test:sidebar`：3 项逻辑、4 项生产组件服务端渲染检查通过。
- 严格 OpenSpec 校验与 `git diff --check` 通过。
- CUA 操作 Chrome 的 `tests/tool-loading/` 页面：使用生产 lazyTool，让第一次加载器抛出与截图相同的 TypeError；局部显示“工具暂时无法打开”和重试按钮，没有触发外层生产 ErrorBoundary 的全局错误页。
- 失败后测试导航可切换到其他工具和主页面；返回后错误状态仍在。点击重试后真实 JsonFormatTool 加载成功，载入示例并格式化得到正确 JSON 结果。
- 已观察浅色恢复页面、深色错误提示截图；外部草稿在开始重试时仍保留。最后一次深色重试停留在加载状态，后续观察曾因自动审核服务额度失败而未执行，因此不将该次重试视为完成证据；浅色重试已有完整成功证据。

## 未验证范围

后续继续时绑定 Chrome 返回 `cgWindowNotFound`；窄窗口视觉检查、深色重试完成后的草稿观察仍待补齐。原始 WebView 故障未重现，Windows/macOS 安装包的实际失败请求与恢复路径未验证。本次证明的是错误隔离和局部恢复能力，不保证模块网络/浏览器缓存故障都能仅靠局部重试恢复。

复现局部恢复：`pnpm --config.verify-deps-before-run=false exec vite --mode tools-qa --host 127.0.0.1 --port 1431`，打开 `http://127.0.0.1:1431/tests/tool-loading/?theme=light`（或 dark）。只使用合成失败与示例数据，不访问用户文件或远端。
