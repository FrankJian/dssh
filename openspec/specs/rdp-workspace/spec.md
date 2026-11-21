# RDP 工作台

## Purpose

当前支持独立原生窗口直连 MVP，认证、信任与生命周期由后端管理。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 配置与原生连接

系统 SHALL 保存独立 RDP 配置，密码存系统凭据库且 DTO 只返回 hasPassword；使用私有参数管道而非命令行/环境/日志传密码；原生 PostConnect 后才标记连接成功，同工作台重复连接聚焦既有客户端。

#### Scenario: worker 启动但握手未完成

- **WHEN** 原生客户端进程已成功创建
- **THEN** 仍显示连接过程，不把进程存在当作已连上远端桌面。

### Requirement: 严格证书与显式跳过

系统 SHALL 默认要求系统信任链与主机名，固定完整 SHA-256 时必须严格匹配；仅逐连接显式启用跳过时禁用链/名称/指纹校验，保持 TLS/NLA并持续显示未验证身份风险，关闭跳过后恢复保留的严格策略。

#### Scenario: 证书更换且指纹不符

- **WHEN** 目标新证书通过 CA 但与保存指纹不同
- **THEN** 拒绝连接，不自动降级，不提供隐式接受任意证书路径。

### Requirement: 窗口和应用锁所有权

系统 SHALL 会话归属工作台，关闭工作台清理 worker，异常父进程退出管道 EOF 退出；锁屏隐藏 RDP 窗口、保留连接并阻止新的敏感交互，解锁恢复；结束后仅手动重连，不自动重复错误密码。

#### Scenario: 锁屏与聚焦并发

- **WHEN** 应用已锁屏但收到聚焦 RDP 请求
- **THEN** 拒绝聚焦，不因迟到操作暴露远程桌面。

### Requirement: 分辨率与首版边界

系统 SHALL 默认固定远端分辨率配本地 smart sizing；逐连接 dynamicResolution 默认 false，启用后经 Display Control 随窗口/DPI变化调整且需服务端支持、重连生效；不把多显示器、SSH 路由、RD Gateway、自动恢复或配置导入导出视为已支持。

#### Scenario: 旧配置缺少动态分辨率字段

- **WHEN** 用户打开迁移前保存的 RDP 连接
- **THEN** 默认维持固定分辨率，不擅自改变远端显示模式。

### Requirement: 发布与诊断边界

系统 SHALL 使用固定版本校验源归档及适配锚点，打包携带所需 runtime，缺引擎明确报错；诊断只含固定初始化阶段与数字错误码，禁止密码、原始远端日志进入错误；构建/协议回归不能替代 Windows Server 登录验收。

#### Scenario: 安装包未含引擎

- **WHEN** 用户发起 RDP 连接
- **THEN** 明确提示缺少引擎，不静默启动其他连接路径。

## Sources and verification

- [rdp](../../../docs/architecture/rdp.md)
- [rdp](../../../docs/guides/rdp.md)
- [rdp](../../../docs/verification/rdp.md)
