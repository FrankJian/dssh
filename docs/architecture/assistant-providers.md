# 智能助手模型配置

> 当前行为契约：[assistant-model-config](../../openspec/specs/assistant-model-config/spec.md)。本文用于使用或实现说明，不另行扩展行为承诺。

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 凭据与兼容

服务描述保存在 `ai_providers`；Key 独立保存在现有 `app_secrets`，当前沿用项目 SQLite 凭据存储，系统钥匙串迁移另行推进。Key 字段只接受写入，返回服务描述时排除；正常对话和模型发现只传服务 ID，Rust 在请求时读取凭据。输入框留空保留原密钥；需要清除时使用显式清除操作后保存。删除服务会同时删除其 Key。

首次加载会导入旧的 `dssh.ai.providers`，将旧 `openai` 配置映射为 Chat Completions，并过滤已退役的 Copilot 条目。所有导入成功后才清理旧 localStorage；失败时保留源数据并允许重试。已存在的同 ID 后端配置不会被旧配置覆盖。编号迁移清理退役的 GitHub 登录令牌。

Anthropic 原生 Messages 路径完整保留 thinking / redacted_thinking 的内容与签名、文本和工具调用块，避免依赖适配器丢失这些字段。MiniMax 预设地址按[官方 Anthropic SDK 文档](https://platform.minimax.cn/docs/api-reference/text-anthropic-api)配置。

Responses 工具迭代带回加密推理上下文，不开启服务端会话存储；依据 [OpenAI Function Calling 指南](https://developers.openai.com/api/docs/guides/function-calling)，工具结果与原调用通过 call ID 关联。模型请求错误不会原样回显服务端响应体，避免第三方错误响应携带密钥。
