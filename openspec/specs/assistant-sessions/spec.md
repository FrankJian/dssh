# 助手后台会话

## Purpose

后台会话由对话拥有，可显式接管；批准、归属和真实连接状态必须保留。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 对话归属与真实状态

系统 SHALL 后台建连不创建终端标签或切换页面，使用真实 session_id、真实连接状态和有界输出；每对话最多 4 个、应用最多 8 个；空闲 15 分钟回收，每 30 秒检查，界面轮询不续期。

#### Scenario: 另一个对话访问后台会话

- **WHEN** 工具用其他 conversation_id 读写 session
- **THEN** 拒绝访问，不把后台会话当作普通用户终端广播。

### Requirement: 输入批准与接管原子性

系统 SHALL 每次交互写入须用户批准，提交时复查会话归属、输入版本及输出快照；接管沿用原 session、目标和 shell 状态，立即使待批准输入失效并禁止后续 AI 输入，不撤回已提交命令。

#### Scenario: 确认期间用户接管

- **WHEN** 用户批准旧输入前已将后台会话接管
- **THEN** 旧输入不被提交，用户可在原终端继续操作。

### Requirement: 隔离关闭与重连

系统 SHALL 复用 SessionManager、SshConnectionPool 与 TOFU；清空对话轮换 ID 并关闭未接管会话，停止助手保留既有会话但取消新建和待操作；后台断开直接结束，重新建立需确认目标，关闭不得中断共享 transport 的其他通道。

#### Scenario: 后台网关断开

- **WHEN** 后台会话在选定资产后失去连接
- **THEN** 结束旧会话，不能自动以网关 shell 冒充原资产继续命令。

## Sources and verification

- [assistant-sessions](../../../docs/guides/assistant-sessions.md)
- [assistant-sessions](../../../docs/architecture/assistant-sessions.md)
- [assistant-sessions](../../../docs/verification/assistant-sessions.md)
