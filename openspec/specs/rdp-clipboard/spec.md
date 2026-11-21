# RDP 剪贴板

## Purpose

逐连接授权的原生剪贴板共享，默认关闭且格式与会话隔离。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 三档权限与默认

系统 SHALL 逐连接保存 off/text/textAndFiles，旧数据默认 off、未知值拒绝、重连生效；off 不开 CLIPRDR，text 只放行 Unicode/兼容文本并拒绝文件格式与 FileContents；不开放 HTML/图片或映射磁盘。

#### Scenario: 文本模式收到文件内容请求

- **WHEN** 远端请求文件流但连接设置为仅文本
- **THEN** 原生策略拒绝该请求，不仅隐藏文件列表。

### Requirement: 原生桥和前台隔离

系统 SHALL 数据在固定引擎原生 worker 处理，不经 React/invoke/日志/配置数据库；只让前台会话发布新的本机剪贴板，Windows 文件单次读取上限 4 MiB、等待 15 秒，断线唤醒并释放资源。

#### Scenario: 后台会话更新远端格式

- **WHEN** 另一个 RDP 会话在后台收到剪贴板通知
- **THEN** 不直接覆盖当前本机系统剪贴板。

### Requirement: 复制语义与验收边界

系统 SHALL 文件模式是双向复制而非跨机剪切删除、拖放或断点续传；普通文件接入已实现，目录、超大文件、多会话、慢链路和真实 Explorer/Finder/Windows Server 仍需验收，不以交叉编译或白名单测试证明互操作完成。

#### Scenario: 用户选择文本和文件

- **WHEN** 保存连接配置并重新连接
- **THEN** 允许白名单文本与文件流，不自动开放磁盘、未知格式或远端策略禁止的能力。

## Sources and verification

- [rdp-clipboard](../../../docs/architecture/rdp-clipboard.md)
- [rdp-clipboard](../../../docs/guides/rdp-clipboard.md)
- [rdp-clipboard](../../../docs/verification/rdp-clipboard.md)
