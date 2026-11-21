# 内置 WebView 浏览器

> 当前行为契约：[webview-browser](../../openspec/specs/webview-browser/spec.md)。本文用于使用或实现说明，不另行扩展行为承诺。

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 后端与隔离

Rust `BrowserManager` 管理页面 ID、窗口归属、标题、URL 与带版本的标签快照；React 用快照协调统一标签和当前表面。所有 UI 命令使用 Tauri 注入的调用方检查归属，不能指定其他窗口或任意脚本。

可信 chrome 位于 `main` 或 `browser-ui-*` WebView；远程内容位于独立 `web-content-*` 子 WebView。远程内容没有 core / plugin capability，全局 custom-command guard 也拒绝其全部应用命令，包括本地源 frame 的调用。网页不接收 SSH / S3 / AI 保存的凭据。

导航拒绝非 HTTP / HTTPS、应用内部域、配置的开发服务器源及内嵌用户名密码。TLS 使用系统默认校验。普通 `target="_blank"` 链接在当前页导航，原生新窗口回调同样验证 URL。下载请求拒绝。

多 WebView 使用 Tauri `unstable` feature，见 [Tauri 文档](https://v2.tauri.app/reference/javascript/api/namespacewebview/)。创建子 WebView 前取得父窗口副本，避免持有 `window_ref` 锁等待 UI 线程时与并发 IPC 互相阻塞。macOS 独立浏览器使用 Overlay 标题栏与预留拖动区。macOS 网页使用完整 Safari 兼容 User-Agent，避免部分站点（例如百度）对默认 WKWebView 标识返回同地址刷新循环；Windows 保留 WebView2 默认标识。

站点 Cookie / 登录态由系统 WebView 数据存储处理；暂不提供独立 profile、清理站点数据、隐私浏览、书签历史、下载管理、扩展和独立 SOCKS 路由。网页不加入终端分屏树，也不与 SSH 生命周期绑定。
