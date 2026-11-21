# JumpServer 图形化资产工作台设计

> 当前行为契约：[jumpserver-workspace](../../openspec/specs/jumpserver-workspace/spec.md)。本文用于使用或实现说明，不另行扩展行为承诺。

> 原始目标方案和调研，尚未实现的目标不视为当前承诺；首版范围见主规格与实施记录。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 10. 首版实施情况

已实现一条可使用的原生 SSH 路径：在「新建连接 → 连接类型」选择 JumpServer；保存的平台与 SSH / RDP 一起显示，可按类型筛选、搜索和记录最近使用，也可通过命令面板打开各平台。资产页由所选连接确定平台，头部只显示返回入口和连接名称，不再设置平台选择下拉框或重复的添加按钮。空状态只提供一个新建入口。当前实现与目标设计的边界如下：

| 项目 | 当前实现 |
| --- | --- |
| 平台配置 | 独立 SQLite 表与 `011_jumpserver_profiles.sql` 幂等迁移；新增 / 编辑 / 删除；每个平台固定 Core、认证类型、用户名或 Key ID 和组织，可关联已有 SSH 配置 |
| 认证 | 用户名 / 密码 → OTP → Bearer，或官方 Access Key HMAC-SHA256 签名；后者签入请求目标（含查询）、Accept 和 Date；读取 `/api/v1/users/profile/` 确认真实身份 |
| 凭据 | 密码 / Secret 可保存在独立系统凭据库，OTP 不保存；本次输入仅在内存使用；响应只含 `hasCredential`，不回显密码 / Secret / Cookie / 令牌 |
| 目录 | 授权节点导航、服务端分页与搜索、授权账号按需读取；未知 SSH / 人工凭据账号明确拒绝；节点当前按层级路径列出，尚不可折叠 |
| 组织隔离 | 请求带 `X-JMS-ORG` 与目录 `org_id` 过滤；客户端额外过滤返回项，详情严格核对组织 / 资产 ID，跨组织响应不作为连接依据 |
| 原生连接 | 本地 `jms:` 非秘密 source ID 代表平台登录代次 + 资产 + 账号；保留现有普通 SSH profile 契约，不新增持久化目标 profile；Rust 每次连接重新验证授权并取 grant |
| 连接池 | grant 使用独立配置版本，每次终端新开 transport，仍通过现有池与共享 TOFU 校验；取消中的 grant 有清理 guard，断线不复用已消费 token |
| 终端生命周期 | 新建 / 分屏 / 重复标签继承 source ID；手动及自动重连重新授权；拆窗沿用已有会话；退出平台先使登录失效、关闭全部所属会话，再广播移除标签 |
| 功能门控 | SFTP、文件树、主机工具、exec 和端口转发不随此来源开放；普通手动 JumpServer 终端原路径保持原有能力 |
| 显示方式与 UI 状态 | 与连接管理共用网格 / 列表 / 分组切换控件；记住本机独立偏好；分组按当前页资产所属目录展开 / 折叠，多目录资产在各组展示，未加载目录和缺失元数据明确标注。切换保留资产选择与账号面板；加载、空结果、禁用资产、错误 / 重试、账号选择及确认流程沿用原实现 |

当前尚未实现资产收藏 / 最近使用、可折叠树、显式 HTTP / SOCKS 代理配置、仅 SSH 已知资产快捷入口和 SSO / 审批接续；复杂认证保留原 SSH 终端或由用户使用官方 Web。不会声明这些目标设计已交付。

[原验证记录](../verification/jumpserver-workspace.md#jumpserver-implementation)

[原验证记录](../verification/jumpserver-workspace.md#jumpserver-auth-sources)

[原验证记录](../verification/jumpserver-workspace.md#jumpserver-password-verification)

### 使用流程：是否关联 SSH、是否要求 OTP

| 配置 / 操作 | 实际认证路径 |
| --- | --- |
| 不关联 SSH，点击登录资产工作台 | Core HTTPS 用户名 / 密码；服务端要求 OTP 才显示验证码步骤，否则直接加载授权资产。选择资产 / 账号后，取临时连接令牌，经 KoKo 打开 SSH 终端 |
| 关联 SSH，点击登录资产工作台 | 与上一行相同；不会自动先连接关联的 SSH，也不会通过其隧道访问 Core |
| 关联 SSH，点击使用现有 SSH 连接 | 独立使用原 SSH profile 的主机、端口、用户名与认证配置；按服务端提示输入密码 / OTP，进入原交互终端，不加载 API 资产列表 |

如果客户端只能访问 KoKo 的 2222 SSH 端口，Core HTTPS 登录与资产目录不可用；不能把 SSH 端口填写为 HTTPS Core 地址。当前可直接使用原 SSH 配置（主机、2222 端口），平台关联只提供快捷入口，而且平台本身仍需填写 Core 地址。要使用 API 图形化目录，需管理员提供获准的 Core HTTPS 网络路径，例如内网 / VPN 或受控 HTTPS 入口。KoKo 不是通用 sshd，不能假设它支持将 Core 通过 SSH 转发出来；当前平台登录也未实现自动隧道。仅 SSH 的图形化目录 / 菜单适配仍属后续功能。

本文所述“第 8 节”指 [原方案的分阶段实施与验收门槛](../history/jumpserver-workspace-plan.md#8-分阶段实施与验收门槛)。原生与真实部署证据集中在 [验收记录](../verification/jumpserver-workspace.md)。
