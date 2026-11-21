# 智能助手模型配置

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## Anthropic Messages 兼容与排错

官方 Messages 路径为 `/v1/messages`，认证使用 `x-api-key`，版本头为 `anthropic-version: 2023-06-01`。自定义服务可填写基础路径或完整 Messages 地址，路径前缀保留；诊断会显示实际发送的最终地址。HTTP 重定向直接报告，不会携带认证头自动跟随到其他地址。

已知 Claude 3.7、4、4.1、4.5 的标准模型 ID 使用 `thinking.type: enabled` 与 `budget_tokens`，不会发送不支持的 `adaptive`。默认 low / medium / high 分别映射 1024 / 4096 / 8192 思考 tokens，并受本次最大输出约束；自定义 API 参数值在这些旧模型上须为 token 预算整数。最大输出不大于 1024 时会返回明确配置错误，不能开启此模式。现代模型及无法识别能力的网关别名继续采用原有自适应字段，不根据模型名推断 API 协议；别名是否支持对应推理参数，以服务错误及厂商文档为准。

依据 [Anthropic API 错误说明](https://platform.claude.com/docs/en/api/errors)与[扩展思考文档](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)：旧模型拒绝 adaptive，手动思考预算至少 1024 且必须小于 max_tokens。Messages 的请求体构造由聊天请求和连接测试共享，避免两者参数不一致。

本地 HTTP 回归覆盖三种协议、完整 Messages 地址、旧模型预算、API Key 前后空白、HTTP 400 / 401、非 JSON / 错误协议的 200、重定向、连接失败、错误字段和编码密钥脱敏。未使用真实厂商 Key 验证。前端类型检查和构建通过；本次浏览器自动化关闭，原生 / 浏览器展开详情的交互验收待完成。
