# 终端外观与配色

## Purpose

在不重建 SSH 会话的前提下管理终端配色、背景叠加与草稿。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 方案与应用外观独立

系统 SHALL 支持内置与自定义方案；跟随外观时分别记忆深浅方案，关闭跟随可固定方案；新建、隐藏、分屏及独立窗口终端均使用最新有效配色，切换不重连、不清屏、不调整 PTY。

#### Scenario: 切换存活实例配色

- **WHEN** 用户选择一个有效方案
- **THEN** 所有存活实例同步完整颜色，并保持会话、输出、尺寸和字体。

### Requirement: 背景色独立叠加

系统 SHALL 提供叠加背景色开关、RGB 色板/HEX 与 0–100% 不透明度；关闭只停用叠加并保留偏好，0% 使用方案底色、100% 使用自选色；深浅分别保存，终端画布与 padding 背景一致。

#### Scenario: 停用后恢复叠加

- **WHEN** 用户关闭再开启叠加背景色
- **THEN** 恢复保存的颜色和透明度，不改变 ANSI、文字、光标或应用全局配色。

### Requirement: 自定义方案的事务与校验

系统 SHALL 禁止覆盖或删除内置方案；复制生成独立草稿与 ID，编辑仅影响预览，保存失败保留输入；名称为去空白后 1–40 个 Unicode 字符且不区分大小写唯一，颜色规范化为 #RRGGBB；删除及放弃修改需确认。

#### Scenario: 取消放弃草稿

- **WHEN** 用户编辑颜色后关闭并取消放弃确认
- **THEN** 草稿保持，当前会话及持久化方案不被未保存更改污染。

### Requirement: 渲染与可读性边界

系统 SHALL 保留程序 RGB 真彩色及扩展索引语义，使用统一 theme 解析与完整赋值；保留 xterm WebGL 选区字形保真约束，不因历史固定选区对比度目标而擅自加亮；只读预览不连接 SSH，不能代替真实 GPU 验收。

#### Scenario: 重新挂载终端

- **WHEN** 终端移窗或 GPU 上下文恢复
- **THEN** 应用当前有效方案，不从旧快照恢复固定主题。

## Sources and verification

- [terminal-appearance](../../../docs/guides/terminal-appearance.md)
- [terminal-appearance](../../../docs/verification/terminal-appearance.md)
- [design](../../../docs/design.md)
