# SFTP 连接库

## Purpose

复用 SSH 配置、认证与连接池，提供独立 SFTP 来源而不隐式启动 shell。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 入口与来源

系统 SHALL 提供可配置显隐的 SFTP 导航，侧栏聚合普通 SSH 与独立 SFTP 配置，支持目录/标签/平铺、来源筛选和搜索；打开侧栏不自动联网，不混入 RDP/S3/JumpServer。

#### Scenario: 打开连接库

- **WHEN** 用户仅展开 SFTP 侧栏
- **THEN** 本地展示配置，不创建后台探测连接或终端。

### Requirement: 连接动作与共享配置

系统 SHALL 默认点击只打开 SFTP，重复点击聚焦已有文件标签；打开 SSH 优先聚焦同配置可用终端，否则显式创建且保持 SFTP；目录/标签在来源间同步，删除前保护打开的文件标签并说明影响范围。

#### Scenario: 仅 SFTP 账号尝试 shell

- **WHEN** 用户对 SFTP-only 配置选择打开 SSH 且服务端拒绝
- **THEN** 错误只属于该 shell，文件标签与独立 SFTP channel 不被主动关闭。

### Requirement: 兼容迁移与认证

系统 SHALL 旧 SSH 配置默认保留 SSH 类型，独立 SFTP 类型参与 CRUD/克隆/YAML 导入导出，代理随配置保存、预览脱敏、拒绝脱敏占位符导入；复用连接池和 TOFU，不新增凭据访问路径。

#### Scenario: 旧库重复升级

- **WHEN** 既有配置库再次执行类型迁移
- **THEN** 配置保持原认证和默认类型，不生成重复连接。

## Sources and verification

- [sftp-connections](../../../docs/guides/sftp-connections.md)
- [sftp-connections](../../../docs/architecture/sftp-connections.md)
- [sftp-connections](../../../docs/verification/sftp-connections.md)
