# 助手模型配置

## Purpose

模型服务、协议、凭据、诊断与上下文预算保持一致。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 协议与服务草稿

系统 SHALL 支持 Chat Completions、Responses 和 Anthropic Messages；厂商预设后端固定地址及协议，自定义服务允许合法基础地址/完整路径；新服务显示名称可为空并使用 placeholder，有取消与草稿保护，发现模型只作候选。

#### Scenario: 取消新增服务

- **WHEN** 用户添加自定义 API 后取消并确认放弃未保存修改
- **THEN** 不保存占位服务，不强行写入预设显示名称。

### Requirement: 凭据只写与兼容

系统 SHALL Key 和额外头值只写后端凭据存储，返回配置不回显；留空保留、显式清除、删除服务同步清理；最多 32 个合法不重复额外头，拒绝传输管理头与控制字符；旧配置导入成功后才删除源数据。

#### Scenario: 旧配置导入失败

- **WHEN** 某个服务不能安全迁移
- **THEN** 保留旧源数据并允许重试，不覆盖已有同 ID 配置，不将密钥写入日志或导出。

### Requirement: 测试与错误诊断

系统 SHALL 测试当前草稿默认模型且不保存，30 秒超时；聊天失败显示折叠脱敏诊断，不含完整提示/工具输出/密钥；模型单请求最多 5 分钟、含退避总计 10 分钟，至多三次请求，认证/余额/普通参数错误不重试，重试不重复工具副作用。

#### Scenario: 服务返回认证错误

- **WHEN** 模型 API 拒绝凭据
- **THEN** 展示脱敏阶段、HTTP 状态等诊断，不无限重试，不泄露服务原始响应中的密钥。

### Requirement: 容量与工具轮次

系统 SHALL 保留结构化模型容量、输入能力与推理档位；最大输出小于上下文，发送前为输出及 5%/至少256 tokens 余量预留预算，超出时压缩早期历史并保持调用/结果配对；不静默裁剪本次输入，预算不可满足时明确失败。

#### Scenario: 多轮工具使输入超预算

- **WHEN** 工具返回后构造下一轮模型请求
- **THEN** 先压缩并重新校验，保留本次目标与成对工具内容，不直接发送已知超预算请求。

### Requirement: 协议上下文与兼容排错

系统 SHALL 原生保留 Messages thinking/签名及 Responses 加密推理上下文，按 call ID 回传工具结果；旧 Claude 标准 ID 用受输出约束的 enabled/budget_tokens 而非不支持的 adaptive，网关别名不推断协议；HTTP 重定向不带认证跟随。

#### Scenario: 收到跨地址重定向

- **WHEN** 服务返回 HTTP 3xx
- **THEN** 报告重定向，不自动携带 API 凭据到新地址。

## Sources and verification

- [assistant-model-config](../../../docs/guides/assistant-model-config.md)
- [assistant-providers](../../../docs/architecture/assistant-providers.md)
- [assistant-model-config](../../../docs/verification/assistant-model-config.md)
