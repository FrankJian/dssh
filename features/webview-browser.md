# 内置 WebView 浏览器

## 入口与工作区

- 「设置 → 外观 → 左侧导航栏」可勾选显示或隐藏浏览器图标，默认隐藏并记住选择；隐藏图标不影响已打开标签或命令面板入口。
- 活动栏上方、连接管理旁的地球按钮，或命令面板「打开浏览器」，默认新建浏览器标签，与终端 / SFTP 共用标签条。支持重排、重命名、双击复制、中键关闭与批量关闭。
- 工具栏或标签右键菜单可移到完整独立工作台，独立窗口仍可继续新建各类标签；关闭窗口会结束其中的会话和页面。移动时通过原生 `reparent` 保留同一 WebView、页面 DOM、表单和历史；关闭标签则销毁页面；关闭当前浏览器标签后，优先回到最近活跃且仍打开的标签，关闭后台浏览器标签不改变当前选择。
- 浏览器切到后台时仅隐藏原生视图，不销毁页面。设置、命令面板和上下文菜单覆盖网页时临时隐藏原生视图，避免原生层遮挡 HTML；面板宽度和窗口尺寸变化会更新原生边界。
- 地址栏输入后按回车导航，不设单独的打开按钮；支持 HTTP / HTTPS，省略协议补 HTTPS。本地服务请明确写 `http://`。支持后退、前进、刷新 / 停止、加载及错误状态。历史边界处保持当前页面。
- 「端口转发」对话框中的本地转发可一键打开 `http://本地地址:端口`；通配地址改为相同地址族的回环地址，IPv6 加括号。HTTPS 服务需自行改协议。浏览器使用本机网络，不自动使用 SSH 代理；关闭网页不会停止转发，停止转发后网页请求会失败。

## 终端 URL 与外部浏览器

普通终端 URL 和 OSC 8 超链接共用链接服务。默认新建内置浏览器标签；「设置 → 终端 → 终端链接」可改为系统默认浏览器、Google Chrome 或 Microsoft Edge，修改即时生效，已有终端也在每次点击时读取设置。偏好按机器保存在 `localStorage`，独立终端窗口同样生效。

外部启动只允许这三个固定选项，不能传入任意程序或命令行。仅接受 HTTP / HTTPS，拒绝 URL 用户名密码和应用内部地址。Chrome / Edge 未安装或无法启动时提示错误；不会静默切换浏览器。Windows 显式 Chrome / Edge 查找标准用户 / 系统安装目录，直接执行程序并把 URL 作为单独参数传递；系统默认使用 opener 的 ShellExecute 路径。

## AI 浏览器工具

- `browser_list_pages`：列出真实页面 ID、标题、URL 和所属窗口。
- `browser_open`：默认新建标签，也可指定独立窗口。
- `browser_read`：读取标题、可见正文（最多 12000 字符）和最多 100 个可操作元素。不返回表单输入值，排除密码、验证码、文件和常见密钥 / 支付字段，不跨域读取 iframe。
- `browser_navigate`：导航到 HTTP / HTTPS URL。
- `browser_interact`：按读取结果中的元素引用逐次点击或填写。完整页面 URL、快照随机 ID、节点连接 / 可见状态与签名必须仍匹配；每次交互后引用失效，需要重新读取。填写最多 4000 字符，只允许普通 input / textarea。

除列出页面外，以上操作全部通过现有 AI 确认流程。读取确认会告知正文将发送给当前模型；操作确认展示实际页面标题、当前 URL、目标元素标签及操作参数。点击可能提交表单或产生外部副作用，仍需逐次确认。认证、验证码、证书警告及敏感字段交给用户；不提供任意 JavaScript 执行工具。系统提示明确网页内容是不可信数据，不能作为新指令或授权。

正文不是截图或完整 DOM；不承诺支持 canvas、跨域 iframe、复杂富文本编辑器或独立弹窗 OAuth。网站自身可能改变操作行为，确认与常见页面变化检查不能使任意网站变为可信来源。

## 后端与隔离

Rust `BrowserManager` 管理页面 ID、窗口归属、标题、URL 与带版本的标签快照；React 用快照协调统一标签和当前表面。所有 UI 命令使用 Tauri 注入的调用方检查归属，不能指定其他窗口或任意脚本。

可信 chrome 位于 `main` 或 `browser-ui-*` WebView；远程内容位于独立 `web-content-*` 子 WebView。远程内容没有 core / plugin capability，全局 custom-command guard 也拒绝其全部应用命令，包括本地源 frame 的调用。网页不接收 SSH / S3 / AI 保存的凭据。

导航拒绝非 HTTP / HTTPS、应用内部域、配置的开发服务器源及内嵌用户名密码。TLS 使用系统默认校验。普通 `target="_blank"` 链接在当前页导航，原生新窗口回调同样验证 URL。下载请求拒绝。

多 WebView 使用 Tauri `unstable` feature，见 [Tauri 文档](https://v2.tauri.app/reference/javascript/api/namespacewebview/)。创建子 WebView 前取得父窗口副本，避免持有 `window_ref` 锁等待 UI 线程时与并发 IPC 互相阻塞。macOS 独立浏览器使用 Overlay 标题栏与预留拖动区。macOS 网页使用完整 Safari 兼容 User-Agent，避免部分站点（例如百度）对默认 WKWebView 标识返回同地址刷新循环；Windows 保留 WebView2 默认标识。

站点 Cookie / 登录态由系统 WebView 数据存储处理；暂不提供独立 profile、清理站点数据、隐私浏览、书签历史、下载管理、扩展和独立 SOCKS 路由。网页不加入终端分屏树，也不与 SSH 生命周期绑定。

## 验证与后续验收

- `pnpm exec tsc --noEmit`、`pnpm build`、`node --experimental-strip-types --test src/browser/browserPreferences.test.mjs`。
- `cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test`。
- `cargo run --example browser_smoke`：需要图形桌面；临时本机 HTTP 服务，不使用模型、SSH 或用户数据库。覆盖完整浏览器 User-Agent（不完整时模拟同地址刷新循环）、AI 正文 / 元素读取、敏感字段排除、确认目标、填写 / 点击、过期引用和 URL 拒绝、移窗保留表单状态与关闭回收。
- macOS 主应用原生验证已覆盖标签 / 连接管理切换、表单保留、独立窗口往返、弹窗覆盖、终端 URL 点击自动新建浏览器标签和链接设置选项。
- Windows WebView2、多显示器 DPI、真实 SSH 转发、外部浏览器安装路径和实际模型 / 登录环境仍需实机验收。

## 独立工作台

浏览器从任意工作台打开时归属当前窗口；分离页面创建完整独立工作台，保留原 WebView 页面状态。独立窗口可继续新建 SSH、浏览器、SFTP，并使用主窗口的连接管理、设置和助手。关闭浏览器标签只关闭页面，关闭工作台关闭其会话和页面，不再自动合并回主窗口。
