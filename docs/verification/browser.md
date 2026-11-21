# 内置 WebView 浏览器

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 验证与后续验收

- `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm test:browser`（链接偏好、浏览器快照激活及工作区标签焦点）。
- `cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test`。
- `cargo run --example browser_smoke`：需要图形桌面；临时本机 HTTP 服务，不使用模型、SSH 或用户数据库。覆盖完整浏览器 User-Agent（不完整时模拟同地址刷新循环）、AI 正文 / 元素读取、敏感字段排除、确认目标、填写 / 点击、过期引用和 URL 拒绝、移窗保留表单状态与关闭回收。
- macOS 主应用原生验证已覆盖标签 / 连接管理切换、表单保留、独立窗口往返、弹窗覆盖、终端 URL 点击自动新建浏览器标签和链接设置选项。
- Windows WebView2、多显示器 DPI、真实 SSH 转发、外部浏览器安装路径和实际模型 / 登录环境仍需实机验收。
