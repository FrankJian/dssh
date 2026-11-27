# 验证与待验收

这里回答的是：已经验证过什么、在什么环境验证、结果和证据是什么、还缺哪些验证。它是本项目选择保留的质量记录目录，不是 OpenSpec 强制要求的目录。

## 与其他文档的区别

| 位置 | 回答的问题 |
| --- | --- |
| `openspec/specs/` | 软件应该具备什么行为？ |
| `openspec/changes/<name>/tasks.md` | 这次变更还要完成哪些实施和验证任务？ |
| `docs/verification/` | 哪些行为已经得到什么程度的验证？证据和局限在哪里？ |
| `TODO.md` | 哪些需求或验收尚未排期，优先级如何？ |

例如，本地 HTTP 测试证明模型协议参数正确，不代表真实厂商账户可用；macOS 预览通过，也不代表 Windows 安装包和真实 SSH 已通过。这里保留这些差别，避免将“代码完成”误报为“可发布”。

## 维护范围

- 保留值得复用的复现步骤、环境/日期、测量数据、实际结果和未验证边界。
- 不重复编写需求或维护新一套实施任务。当前变更的验证工作在该 change 内跟踪；这里保存跨变更需要引用的证据。
- 迁入的终端配色/性能实施清单保留原状态供追溯；后续继续实施时，将相关未完成项纳入具体 change，不在两处重复勾选。
- 没有持续参考价值的临时检查过程无需另建文档；过时记录移入 history，未完成验收不能因整理或构建通过而标记完成。

## 验收记录

[返回文档导航](../README.md)

- [工具箱模块加载恢复](tool-module-loading.md)
- [统一侧栏详情](sidebar-details.md)
- [AI 助手停靠布局](assistant-docking.md)
- [AI 助手的 JumpServer 交互](assistant-jumpserver.md)
- [智能助手模型配置](assistant-model-config.md)
- [AI 后台交互会话](assistant-sessions.md)
- [内置 WebView 浏览器](browser.md)
- [文档迁移检查（2026-11-21）](documentation-migration-2026-11-21.md)
- [界面重设计方向：柔和几何与整体配色](interface-redesign.md)
- [性能、可靠性与交互审计（2026-11-19）](performance-reliability-audit-2026-11.md)
- [RDP 双向剪贴板调研与实施方案](rdp-clipboard.md)
- [RDP 首版实施说明](rdp.md)
- [Monaco 远程代码编辑器规格](remote-editor.md)
- [文本编辑器验证记录](editor-workspace.md)
- [远程 Explorer 增强规格](remote-explorer.md)
- [SFTP 连接库方案](sftp-connections.md)
- [SFTP 双栏工作台](sftp.md)
- [终端配色：迁入的实施与验收清单](terminal-appearance-tasks.md)
- [终端多配色方案与自定义颜色](terminal-appearance.md)
- [终端 ZMODEM 与 JumpServer 文件传输规格](terminal-file-transfer.md)
- [终端输出消费确认与过载保护](terminal-output.md)
- [终端性能：迁入的实施与验收清单](terminal-performance-tasks.md)
- [Artifactory 验证记录](artifactory.md)
- [JumpServer 资产工作台验证记录](jumpserver-workspace.md)
- [快捷键验证记录](keyboard-shortcuts.md)

- [命令输出记录](terminal-command-output.md)
