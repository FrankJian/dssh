# SFTP 连接库方案

> 当前行为契约：[sftp-connections](../../openspec/specs/sftp-connections/spec.md)。本文用于使用或实现说明，不另行扩展行为承诺。

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 5. 数据与实现边界

### 当前基础

- `app/ActivityBar.tsx` 目前包含会话、连接管理和 S3，需要新增 SFTP Activity。
- `ssh/connectionTypes.ts` 已预留 SFTP 选项，但当前不可用，且保存的 SSH DTO 未区分 SSH / SFTP。
- `app/App.tsx` 的打开 SFTP 路径已经不创建终端，文件操作按 profile ID 读取配置。
- `app/sftpTerminal.ts` 已按配置 ID 查找匹配终端，可复用并补充“没有终端则新建”的分支。
- SFTP 标签已支持保持挂载、目录状态、传输任务与跨窗口工作区；新入口必须复用这些机制。

### 推荐数据方案

扩展现有 SSH 传输配置，新增受约束的 `connectionType: "ssh" | "sftp"` 字段，旧数据默认 `ssh`。该字段决定显示分类与默认打开动作，认证、profile ID、目录、标签及代理仍复用原有存储与仓库。

这样独立 SFTP 配置在产品上是独立类型，在传输层可以直接使用现有 SFTP 命令和 `SshConnectionPool`。无需维护第二套凭据副本或绕过连接池。SQLite 增加编号迁移，同步 Rust serde 默认值、请求 DTO、TypeScript 类型、服务封装、编辑草稿和导入导出；旧 YAML / 旧数据库缺少字段时兼容为 SSH，未知类型明确报错。

普通打开连接的处理器应基于配置类型分派；“打开 SSH 终端”走显式终端入口，避免 SFTP 类型被默认分派再次带回文件管理。后端不要依据分类字段推断服务器一定允许 shell。

### 主要改动

| 范围 | 工作 |
| --- | --- |
| 导航与设置 | ActivityId、默认导航配置、已有偏好升级、展开 / 折叠、快捷命令 |
| SFTP 连接侧栏 | 新增组件，复用目录树 / 标签 / 搜索与行菜单 |
| 连接配置 | SSH / SFTP 分类、表单、克隆、CRUD、迁移、导入导出 |
| 连接管理 | 启用 SFTP 类型，默认动作分派，显示与筛选 |
| 工作区 | 从侧栏打开时保留 SFTP 导航；终端跳转；标签去重、关闭和跨窗口归属 |
| Rust 传输层 | 继续使用共享连接池、独立子系统 / shell 通道与现有 TOFU |

密码、私钥、口令和代理凭据只由 Rust 解析；列表、日志与前端读响应不返回秘密。打开 SSH 不自动接受主机密钥变化。编辑或删除配置时沿用已有会话 / 任务保护，不能静默中断传输。
