# 远程 Explorer

## Purpose

通过 SFTP 提供可观察的传输、多选、移动与受保护删除。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 共享 SFTP 与传输

系统 SHALL 只通过 Rust SftpManager、共享连接池和 TOFU 操作文件，不拼 shell rm/mv/mkdir；传输使用 operationId 与进度/结果，上传按有界块流式复制，本地拖放按悬停目录或根目录上传，批次串行。

#### Scenario: 上传大文件

- **WHEN** 用户从文件树提交本地文件
- **THEN** 不一次读取完整文件，持续报告当前操作进度与失败。

### Requirement: 可见选择与同主机移动

系统 SHALL 支持普通单选、Ctrl/Command 切换和 Shift 可见范围选择；同 profile 移动只允许普通目录，拒绝根目录、自身/子孙及同名冲突，当前不提供移动覆盖；移动后同步树与编辑器路径。

#### Scenario: 移动存在同名冲突

- **WHEN** 用户把选中项目拖入已有同名目标的目录
- **THEN** 拒绝冲突，不执行原方案里建议但未实现的覆盖。

### Requirement: 预览确认与取消删除

系统 SHALL 递归删除先经 SFTP 预览并确认，限制 64 层/10000 项，保护根目录和远程主目录；不跟随符号链接、深度优先删除，operationId 可取消，保留已删/未处理/失败信息。

#### Scenario: 取消进行中的递归删除

- **WHEN** 用户在删除进度中请求取消
- **THEN** 停止新的删除请求，不把已删除内容假称可撤销，不借 shell 绕过限制。

### Requirement: 权限降级

系统 SHALL 属性展示服务器可用的元数据，支持明确的 3/4 位八进制 POSIX 权限并确认，未返回权限时只读降级；默认不修改属主/属组。

#### Scenario: 服务器不返回权限

- **WHEN** 用户打开该文件属性
- **THEN** 显示可用元数据，不提供会虚报成功的权限保存。

## Sources and verification

- [remote-explorer](../../../docs/architecture/remote-explorer.md)
- [remote-explorer](../../../docs/verification/remote-explorer.md)
