# 当前需求基线

本文按能力导航。正文定义当前工作区约定，发布与真实环境验收以 [验证记录](verification/README.md)为准。通用界面规则见 [docs/design.md](design.md)，未实施的 VNC、原生窗口材质不属于当前行为基线。

| 能力 | 要求 |
| --- | --- |
| 终端外观与配色 | [terminal-appearance](../openspec/specs/terminal-appearance/spec.md) |
| 终端输出与历史 | [terminal-output](../openspec/specs/terminal-output/spec.md) |
| 命令输出预览与复制 | [terminal-command-output](../openspec/specs/terminal-command-output/spec.md) |
| 终端文件传输 | [terminal-file-transfer](../openspec/specs/terminal-file-transfer/spec.md) |
| 助手后台会话 | [assistant-sessions](../openspec/specs/assistant-sessions/spec.md) |
| 工作区布局与助手停靠 | [workspace-layout](../openspec/specs/workspace-layout/spec.md) |
| 助手 JumpServer 交互 | [assistant-jumpserver](../openspec/specs/assistant-jumpserver/spec.md) |
| 助手模型配置 | [assistant-model-config](../openspec/specs/assistant-model-config/spec.md) |
| SFTP 连接库 | [sftp-connections](../openspec/specs/sftp-connections/spec.md) |
| SFTP 双栏工作台 | [sftp-workspace](../openspec/specs/sftp-workspace/spec.md) |
| 远程 Explorer | [remote-explorer](../openspec/specs/remote-explorer/spec.md) |
| 远程文本编辑器 | [remote-editor](../openspec/specs/remote-editor/spec.md) |
| RDP 工作台 | [rdp-workspace](../openspec/specs/rdp-workspace/spec.md) |
| RDP 剪贴板 | [rdp-clipboard](../openspec/specs/rdp-clipboard/spec.md) |
| Artifactory 构件工作台 | [artifactory-workspace](../openspec/specs/artifactory-workspace/spec.md) |
| JumpServer 资产工作台 | [jumpserver-workspace](../openspec/specs/jumpserver-workspace/spec.md) |
| 内置浏览器 | [webview-browser](../openspec/specs/webview-browser/spec.md) |
| 应用快捷键 | [keyboard-shortcuts](../openspec/specs/keyboard-shortcuts/spec.md) |

新增能力或行为变化先建立 change，避免直接覆盖主规格而丢失决策和验收过程。
