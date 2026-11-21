# 终端文件传输

## Purpose

记录已接入的 SSH PTY rz/sz 边界；JumpServer SFTP 定制仍未实现。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 原始通道与用户确认

系统 SHALL 由 Rust 按 session 管理原始字节分流和唯一传输引擎，继续走既有连接池与 TOFU；实时有效协议候选需用户确认，历史回放不得触发选择器或传输，后台 AI 会话不自动选文件。

#### Scenario: 历史含协议头

- **WHEN** 终端回放保存输出中的 rz 初始化字节
- **THEN** 不弹出本地文件选择器，不发送协议回复。

### Requirement: 取消与输入互斥

系统 SHALL 支持 rz 上传和 sz 下载，原生文件选择取消必须结束本次传输且只结束一次；传输期间普通键盘、粘贴、AI 和设备回复不得污染帧，取消/关闭保持响应。

#### Scenario: 取消选择文件

- **WHEN** 用户取消 rz 的原生选择器
- **THEN** 终止该次协商，不反复弹窗，下一次显式传输仍可工作。

### Requirement: 完整性与生命周期

系统 SHALL 流式传输、校验文件名和目标冲突，未经确认不覆盖，失败不虚报目标成功；跨窗口保持同一 session 所有权，断线旧传输不恢复，不影响其他通道；未验证的大文件、tmux/嵌套 SSH 组合不泛化承诺。

#### Scenario: 连接中断

- **WHEN** 一项传输尚未完成时会话断开
- **THEN** 传输结束并呈现失败或取消状态，不把重连当作旧传输续传。

## Sources and verification

- [terminal-file-transfer](../../../docs/architecture/terminal-file-transfer.md)
- [terminal-file-transfer](../../../docs/verification/terminal-file-transfer.md)
