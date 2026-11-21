# Artifactory 构件工作台

## Purpose

按 Token 权限浏览、传输和编辑属性，避免递归扫描和凭据泄漏。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 连接与导航

系统 SHALL 提供默认隐藏的可配置入口，支持多连接及 Access Token；URL 接受平台根或 artifactory 后缀，读取只返回 hasToken；按需列授权仓库和目录，忽略过期响应，不全库递归扫描。

#### Scenario: 仅删除本地连接

- **WHEN** 用户确认删除 Artifactory 连接
- **THEN** 删除配置和 Token，不删除远端仓库或构件。

### Requirement: 有界传输与结果

系统 SHALL 支持多文件上传、文件下载和受服务端能力约束的本地/缓存仓库 ZIP 下载；同名上传确认，队列最多并发2项/保留200项，切页面继续但退出不恢复；下载临时文件成功重命名、失败或取消清理。

#### Scenario: 下载期间切换页面

- **WHEN** 用户离开 Artifactory 页面
- **THEN** Rust 队列继续，回到页面能看到进度与结果，不称支持断点续传。

### Requirement: 属性与安全

系统 SHALL 多值属性增改删需对应权限，删除确认，PATCH 固定 recursiveProperties=0；网络/Token 仅后端处理，校验路径、禁止认证重定向、不回显远端原始错误体；归档/属性能力受 Pro、服务端配置及权限限制。

#### Scenario: 目录属性编辑

- **WHEN** 用户修改目录的一项属性
- **THEN** 仅更新该项，不递归修改子项或绕过服务端权限。

## Sources and verification

- [artifactory](../../../docs/guides/artifactory.md)
- [artifactory-evolution](../../../docs/history/artifactory-evolution.md)
