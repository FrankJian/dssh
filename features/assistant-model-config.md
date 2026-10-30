# 智能助手模型配置

配置方式参考 [DeepSeek Harness 的 Providers 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)：厂商预设由后端解析固定地址与协议，仅填写 API Key；自定义 API 可直接填写网关地址与协议，模型列表可手动维护。

## 使用

1. 打开 AI 助手的「模型配置」，点击「添加服务」。
2. 选择预置厂商后只需填写 API Key，连接地址和协议不显示、不需要选择；使用「自定义 API / 中转网关」时才填写显示名称、地址、协议与可选代理。
3. 输入 API Key；Ollama、LM Studio 等不要求认证的本地服务可留空。
4. 在“模型列表”下填写模型 ID、显示名称和上下文窗口，首个模型填好后可直接保存或测试，无需点击“添加模型”；需要配置多个模型时，点击“添加模型”后再填写下一项。显示名称留空时使用模型 ID；上下文窗口默认 256K，最大输出默认 32K tokens；支持 K / M 简写（K = 1000）。每项支持编辑、移除和设为默认。最后点击“保存配置”，将服务和模型一起保存。
   如需发现可用模型，点击模型目录右上角的“获取可用模型”；发现结果仅作为模型 ID 输入框的搜索候选，选择后仍需点击添加，不会自动加入整个列表。
5. 在对话输入区搜索厂商或模型并选择。切换保留聊天历史，仅作用于后续请求；运行期间禁用切换，最近选择在本机保留。

同一网关提供多种协议时，可添加多个服务配置。预设固定使用经过核对的官方连接参数，不承诺账户权限或实时模型目录。百炼等服务的 Key 必须匹配预设标明的地域；其他地域、专属工作区、自建网关与非默认本地端口请用自定义 API。API 协议必须与服务实际支持的接口一致。

| 协议 | 配置值 | 基础地址后追加的路径 |
| --- | --- | --- |
| OpenAI Chat Completions | `openai-completions` | `chat/completions` |
| OpenAI Responses | `openai-responses` | `responses` |
| Anthropic Messages | `anthropic-messages` | `messages` |

地址支持基础路径或完整的上述接口地址；完整接口后缀会被归一化，网关路径前缀保留。仅填写域名时补 `/v1/`。地址不接受内嵌凭据、查询参数或片段。代理在「连接选项」中填写。

## 测试连接

「保存配置」旁提供「测试连接」：使用当前表单的默认模型（包含尚未点击添加的首个模型）发送一条简短请求，验证实际推理接口，而非仅检查模型列表。支持三种协议，测试不保存表单或聊天记录；未输入新 Key 时仅在 Rust 侧读取该服务已保存的 Key，显式清除 Key 则按无密钥测试。显示成功结果、模型与耗时，失败提供配置检查提示，30 秒超时。不回显模型返回文本或第三方错误响应体。测试最多输出 1024 tokens，实际调用可能产生厂商 API 费用。

## 模型选项与自动压缩

模型编辑区按身份、容量、输入类型、推理选项排列，可收起详细设置。每个模型保存 `id`、`displayName`、`contextWindow`、`maxOutputTokens`、`inputTypes`、`reasoningLevels` 和当前 `reasoningEffort`。新模型默认上下文 256K、最大输出 32K、文本开启、图片关闭、推理等级关闭；K = 1000，M = 1000000。已有配置的上下文容量保持原值；旧配置缺少输出上限时兼容补默认值，小窗口按其容量缩小输出默认值。

文本为当前必需输入类型，图片复选框用于记录模型能力；当前助手的消息输入仍为文本。启用推理等级后，默认出现 off / low / medium / high 四行，每行包含「档位」和「API 参数值」，可增删档位。非 off 的 API 参数值留空时使用档位名称；off 不需要填写，已有的非空 API 值会保留并发送。至少保留一行；要停用整个配置可关闭推理等级开关。

对话输入区可切换已配置的推理档位，运行中的请求保持原选择。API 值不会被强制转换成 low / medium / high，例如 `high → provider-special` 会实际发送 `provider-special`。

- OpenAI Chat Completions 使用 `reasoning_effort`，Responses 使用 `reasoning.effort`；空 off 使用 `none`。不同模型可用档位不同，部分模型不支持关闭推理，应移除不支持的档位。见 [OpenAI 官方推理说明](https://developers.openai.com/api/docs/guides/reasoning)。
- Anthropic Messages 使用 `output_config.effort`；推理时使用 adaptive thinking，off 使用 disabled。部分 Claude 模型不支持关闭 thinking，声明前应查对应模型文档。见 [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort)。
- DeepSeek 预设另外发送 `thinking.type` 开关；OpenRouter 使用其 `reasoning` 对象。见 [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/) 与 [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。

自定义 API 按选择的协议发送参数；中转服务和模型必须实际支持所配置的值。最大输出必须小于上下文窗口。

不再提供历史压缩阈值、近期长度或分块大小的手动配置；旧 localStorage 中的这些选项不再生效。每次发送完整请求前（包括每次工具调用后的下一轮）自动执行：

1. 估算系统提示、工具定义、聊天历史、当前输入、工具参数、工具返回和协议内容块的 token 用量。
2. 预留模型设置的最大输出和 5%（至少 256 tokens）的余量。未超过输入预算时原样发送。
3. 超过预算时，先对早期记录及已完成工具轮次分块生成摘要，保留本次用户输入；工具调用与结果成组处理，避免孤立 call ID 或思考签名。
4. 将摘要作为明确标记的背景数据放入请求，重新检查；只有估算用量回到预算内才发主请求。摘要请求也受预算和输出上限约束。支持停止时取消正在进行的压缩请求。

不同服务的 tokenizer 各不相同，目前是本地混合文本估算与余量预留，并非厂商精确计数。摘要失败时使用带省略标记的有界原文片段回退；系统提示、工具定义和本次输入本身已超过预算时明确报错，不静默裁剪本次用户输入，也不继续发送超出本地预算的请求。

旧版 localStorage 和 SQLite 中的纯模型 ID 列表在读取时兼容转换；保存时写入结构化条目，已有密钥与默认选择保留。

## 预置厂商地址核对

核对日期：2026-10-29。前后端共享 `src/ai/providerPresets.json`；后端保存、请求与模型发现都会按预设 ID 固定解析地址和协议，忽略来自表单的预设地址覆盖。旧版地址与协议恰好匹配官方预设时兼容识别；显式标记为自定义的服务始终保留自己的设置。

| 厂商 | 基础地址 | 协议 | 官方来源 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/` | Chat Completions | [文档 / 官方 SDK](https://api-docs.deepseek.com/) |
| OpenAI | `https://api.openai.com/v1/` | Responses | [文档 / 官方 SDK](https://developers.openai.com/api/reference/resources/responses/methods/create) |
| Anthropic | `https://api.anthropic.com/v1/` | Messages | [文档 / 官方 SDK](https://platform.claude.com/docs/en/api/overview) |
| OpenRouter | `https://openrouter.ai/api/v1/` | Chat Completions | [文档 / 官方 SDK](https://openrouter.ai/docs/quickstart) |
| Moonshot / Kimi（中国大陆） | `https://api.moonshot.cn/v1/` | Chat Completions | [文档 / 官方 SDK](https://github.com/MoonshotAI/moonpalace/blob/main/endpoint.go) |
| 阿里云百炼（北京） | `https://dashscope.aliyuncs.com/compatible-mode/v1/` | Chat Completions | [文档 / 官方 SDK](https://help.aliyun.com/en/model-studio/base-url) |
| 硅基流动（中国大陆） | `https://api.siliconflow.cn/v1/` | Chat Completions | [文档 / 官方 SDK](https://api-docs.siliconflow.cn/docs/api/chat-completions-post) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | Chat Completions | [文档 / 官方 SDK](https://ai.google.dev/gemini-api/docs/openai) |
| 智谱 / GLM（中国大陆） | `https://open.bigmodel.cn/api/paas/v4/` | Chat Completions | [文档 / 官方 SDK](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) |
| MiniMax（中国大陆） | `https://api.minimax.cn/anthropic/v1/` | Messages | [文档 / 官方 SDK](https://platform.minimax.cn/docs/api-reference/text-anthropic-api) |
| Ollama（本地默认端口） | `http://localhost:11434/v1/` | Chat Completions | [文档 / 官方 SDK](https://docs.ollama.com/api/openai-compatibility) |
| LM Studio（本地默认端口） | `http://localhost:1234/v1/` | Chat Completions | [文档 / 官方 SDK](https://lmstudio.ai/docs/developer/openai-compat) |

Kimi 国内文档在本次抓取时超时；国内域名核对自其官方 Moonpalace SDK 源码，OpenAI 兼容协议和 `/v1` 前缀另参见 [Kimi 官方客户端配置说明](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/providers.md)。核对是文档与 SDK 检查，未使用真实账户 Key 对所有厂商进行付费联调。

## 凭据与兼容

服务描述保存在 `ai_providers`；Key 独立保存在现有 `app_secrets`，当前沿用项目 SQLite 凭据存储，系统钥匙串迁移另行推进。Key 字段只接受写入，返回服务描述时排除；正常对话和模型发现只传服务 ID，Rust 在请求时读取凭据。输入框留空保留原密钥；需要清除时使用显式清除操作后保存。删除服务会同时删除其 Key。

首次加载会导入旧的 `dssh.ai.providers`，将旧 `openai` 配置映射为 Chat Completions，并过滤已退役的 Copilot 条目。所有导入成功后才清理旧 localStorage；失败时保留源数据并允许重试。已存在的同 ID 后端配置不会被旧配置覆盖。编号迁移清理退役的 GitHub 登录令牌。

Anthropic 原生 Messages 路径完整保留 thinking / redacted_thinking 的内容与签名、文本和工具调用块，避免依赖适配器丢失这些字段。MiniMax 预设地址按[官方 Anthropic SDK 文档](https://platform.minimax.cn/docs/api-reference/text-anthropic-api)配置。

Responses 工具迭代带回加密推理上下文，不开启服务端会话存储；依据 [OpenAI Function Calling 指南](https://developers.openai.com/api/docs/guides/function-calling)，工具结果与原调用通过 call ID 关联。模型请求错误不会原样回显服务端响应体，避免第三方错误响应携带密钥。

## 验证

- `pnpm test:ai-config`：旧配置转换、退役条目过滤、预设与协议、自定义配置及损坏源数据保留。
- `cargo test`：本地 HTTP 服务验证三种协议的路径、认证头、工具声明、工具调用及结果回传，并验证 Responses 加密推理回传与凭据只写生命周期。
- 真实厂商账户、代理及跨平台原生窗口验收见 TODO.md。
