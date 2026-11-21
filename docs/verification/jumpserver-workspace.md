# jumpserver-workspace 验证记录

> 迁自使用/实现说明；证据等级与未完成状态保留原记录，不因迁移补做任何验收。


<a id="jumpserver-implementation"></a>

验证包含 TypeScript 与生产构建、Rust 格式化 / Clippy / 完整测试；新增回归覆盖独立 HMAC 向量、真实回环 HTTP 请求序列化、查询签名、非默认 KoKo 端口、grant 绑定、错误脱敏、组织过滤、登录失效、连接 key 隔离与重复数据库迁移。隔离浏览器用合成资产验证搜索、多账号选择、单账号 Enter 连接、退出确认及深浅主题 / 窄窗口。尚无真实 JumpServer / KoKo 账户验证，不能据此标记为稳定发行；需要重启原生开发进程加载新 Rust 命令，单独 Vite HMR 不足。

<a id="jumpserver-auth-sources"></a>

实现认证时补充核对了[官方 Access Key 签名示例](https://github.com/jumpserver/docs/blob/v4.0/docs/dev/rest_api.md)、[用户身份路由](https://github.com/jumpserver/jumpserver/blob/v4.10.18/apps/users/urls/api_urls.py)和[授权账号 / 协议字段](https://github.com/jumpserver/jumpserver/blob/v4.10.18/apps/perms/serializers/user_permission.py)。实际服务端版本与配置的发布验收仍按第 8 节执行。

<a id="jumpserver-password-verification"></a>

密码认证实现核对了官方 [Token API](https://github.com/jumpserver/jumpserver/blob/dev/apps/authentication/api/token.py)、[Token serializer](https://github.com/jumpserver/jumpserver/blob/dev/apps/authentication/serializers/token.py)、[MFA challenge](https://github.com/jumpserver/jumpserver/blob/v4.10.18/apps/authentication/api/mfa.py) 和[认证会话逻辑](https://github.com/jumpserver/jumpserver/blob/dev/apps/authentication/mixins.py)。回环集成测试覆盖 Cookie 轮换、CSRF、OTP 错误重试、Bearer 身份检查、外部 challenge / 重定向拒绝、并发提交、取消及窗口关闭；隔离浏览器验证使用合成密码和 OTP。真实部署的用户名 / 密码及 OTP 策略、版本差异和 macOS / Windows 原生输入仍待验收。
