# JumpServer 资产工作台

## Purpose

以当前首版授权资产目录和 KoKo SSH 路径为基线，远期方案单列。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 平台身份与凭据

系统 SHALL 平台配置可使用密码/OTP/Bearer 或 Access Key 签名，读取真实用户身份；OTP不保存，公开响应仅含 hasCredential；关联 SSH 是单独兼容动作，不自动借其隧道访问 Core。

#### Scenario: 服务端不要求 OTP

- **WHEN** 用户用用户名密码成功完成 Core 认证
- **THEN** 直接加载授权资产，不强迫额外 OTP 步骤或先连关联 SSH。

### Requirement: 组织与授权校验

系统 SHALL 按组织请求和过滤节点、资产与授权账号，详情核对组织和资产 ID；按需分页和搜索，未知 SSH/人工凭据账号明确拒绝；不把可折叠树、资产收藏/最近使用、显式代理、SSO审批接续视为当前已交付。

#### Scenario: 跨组织响应

- **WHEN** Core 返回与当前组织不符的资产详情
- **THEN** 拒绝以该响应发起连接，不仅在列表隐藏它。

### Requirement: grant 与会话身份

系统 SHALL 使用包含登录代次/资产/账号的非秘密 source ID，每次新建和重连重新授权 grant，经连接池与共享 TOFU 建 transport；分屏继承 source，移窗保留会话，退出先使登录失效并关闭所属全部会话。

#### Scenario: 断线后重连资产

- **WHEN** 用户重连原资产终端
- **THEN** 重新验证授权并取新 grant，不复用已消费 token 或错误目标身份。

### Requirement: 能力门控

系统 SHALL 当前资产来源只开放经过验证的原生 SSH 路径，不顺带开放 SFTP、文件树、hosttools、exec、转发；原普通手动 SSH JumpServer 路径保持已有能力，不能把 grant 终端当作普通持久化 SSH profile。

#### Scenario: 对资产终端打开主机工具

- **WHEN** 当前来源未支持该能力
- **THEN** 呈现禁用或明确限制，不私自新建直连或绕过堡垒机。

## Sources and verification

- [jumpserver-workspace](../../../docs/architecture/jumpserver-workspace.md)
- [jumpserver-workspace-plan](../../../docs/history/jumpserver-workspace-plan.md)
