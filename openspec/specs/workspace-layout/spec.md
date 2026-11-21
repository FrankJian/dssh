# 工作区布局与助手停靠

## Purpose

工作台拥有自身标签与分屏，助手停靠使用独立偏好并保留状态。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 助手方向与状态保留

系统 SHALL 支持左、底、右停靠且默认右侧；左侧位于原侧栏与主区之间，底部只占主区下方；与主机工具互斥，主机工具固定右侧。切换停靠不得移动组件到不同 DOM 父节点或丢失草稿、滚动、确认与终端状态。

#### Scenario: 运行中切换停靠

- **WHEN** 用户把右侧助手切到左侧或底部
- **THEN** 聊天和终端状态保留，原侧栏及顶部标签仍按布局可用。

### Requirement: 尺寸与偏好

系统 SHALL 左右共享默认 360、范围 280–640px 的宽度；底部独立默认 320、范围 220–600px 的高度；支持拖动、方向键 16px、Shift 40px、Home/End 和双击默认，窄窗口临时收紧或隐藏侧栏但不覆盖偏好。

#### Scenario: 窗口缩小再放大

- **WHEN** 可用空间不足以容纳保存的侧栏和助手尺寸
- **THEN** 临时适配并在空间恢复后使用原偏好，不永久改变折叠选择。

### Requirement: 分屏与独立窗口所有权

系统 SHALL 每个终端标签使用无面板数上限的嵌套分屏树，新分屏继承聚焦面板主机，跨轴保持原比例；移窗保持同一 session 与整棵树，独立工作台可新建标签；关闭窗口只关闭其会话且有运行任务确认，不合并回其他窗口。

#### Scenario: 关闭独立工作台

- **WHEN** 用户确认关闭含运行会话的独立窗口
- **THEN** 只结束该窗口的会话，主窗口其他标签保持，不恢复旧标签到父窗口。

## Sources and verification

- [assistant-docking](../../../docs/architecture/assistant-docking.md)
- [assistant-docking](../../../docs/verification/assistant-docking.md)
- [工程结构与工作区架构](../../../docs/architecture/project-structure.md)
