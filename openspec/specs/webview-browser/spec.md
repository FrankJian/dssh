# 内置浏览器

## Purpose

独立远程 WebView 与可信应用 chrome 隔离，标签移窗保留页面状态。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 导航与工作台

系统 SHALL 使用统一标签条和本机网络，HTTP/HTTPS 地址省略协议补 HTTPS；后台只隐藏原生页面，模态覆盖时临时隐藏，移窗 reparent 保留 DOM/表单/历史；关闭页面销毁视图，关闭工作台结束其页面和会话而不合并回主窗口。

#### Scenario: 移动正在填写的页面

- **WHEN** 用户将浏览器标签分离到独立完整工作台
- **THEN** 保留同一页面与表单，首次快照可恢复选择，后续元数据更新不夺取标签选择。

### Requirement: 内容与 URL 隔离

系统 SHALL 远程 web-content 无应用 capabilities，guard 拒绝其所有命令及本地源 frame；拒绝非 HTTP/HTTPS、内嵌凭据、内部地址及开发服务器源，TLS系统校验、下载拒绝，不向网页提供已存 SSH/S3/AI 凭据。

#### Scenario: 网页调用应用命令

- **WHEN** 远程页面试图 invoke SSH 或其他应用命令
- **THEN** 拒绝调用，即使页面包含本地源 frame。

### Requirement: AI 读取和操作授权

系统 SHALL 除列页面外每次浏览器工具须确认；正文最多12000字符、元素最多100，排除敏感字段值和跨域 iframe；交互仅有效快照引用，校验 URL/nonce/连接与可见状态/签名，交互后失效，不提供任意 JS。

#### Scenario: 确认期间页面变化

- **WHEN** 用户批准点击时目标引用已不匹配当前快照
- **THEN** 拒绝旧操作并要求重新读取，不把网页内容当授权指令。

### Requirement: 终端链接与外部程序

系统 SHALL 终端普通/OSC8链接使用同一偏好，可选内置、系统默认、Chrome、Edge；外部启动限固定程序和独立 URL 参数，只接受合法 HTTP/HTTPS，缺程序报错而不静默改选，不支持任意命令行。

#### Scenario: 指定 Chrome 未安装

- **WHEN** 用户点击终端链接但指定浏览器不可用
- **THEN** 显示启动错误，保留选择，不启动任意替代程序。

## Sources and verification

- [browser](../../../docs/guides/browser.md)
- [browser](../../../docs/architecture/browser.md)
- [browser](../../../docs/verification/browser.md)
