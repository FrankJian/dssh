# 助手 JumpServer 交互

## Purpose

资产 API 与经典菜单路径均须以实际授权和同一目标终端为依据。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 平台授权与登录

系统 SHALL 复用所选平台登录，在认证过期时请求用户登录；授权资产和账号选择、连接由用户确认，经 KoKo 建立后台终端，凭据仅在后端处理，退出平台关闭所属前后台资产会话。

#### Scenario: 平台登录过期

- **WHEN** 助手搜索资产时 Core API 返回认证过期
- **THEN** 展示登录流程，成功后继续原请求，不泄露密钥给模型。

### Requirement: 菜单输入与目标连续性

系统 SHALL 经典菜单流程读取实际输出，逐次批准精确单行输入，选服和目标 shell 后续操作沿用同一 PTY session，不用 exec 继承目标；禁止控制字符，输入 1–1024 字符并追加一次回车。

#### Scenario: 账号选择不明确

- **WHEN** 实际输出中有多个可用账号且用户未指定
- **THEN** 询问用户，不写死编号或把搜索/输入已发送报告成连接成功。

### Requirement: 快照和并发防护

系统 SHALL 写入前复查快照与输入版本，手动输入、输出变化、关闭和重复确认均不得误提交旧输入；read 等待至多 10000ms，write 等待默认 2000ms、范围 200–10000ms，输出稳定约 120ms 可提前返回，但回显或短暂稳定不是成功证明。

#### Scenario: 确认等待时终端变化

- **WHEN** 用户手动输入或服务器输出使批准依据过期
- **THEN** 拒绝旧写入并重新读取，不用重复提交 IP 等待连接。

## Sources and verification

- [assistant-jumpserver](../../../docs/guides/assistant-jumpserver.md)
- [assistant-jumpserver](../../../docs/verification/assistant-jumpserver.md)
