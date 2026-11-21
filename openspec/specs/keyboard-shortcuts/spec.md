# 应用快捷键

## Purpose

平台修饰键、上下文、用户绑定与 shell 输入保持明确优先级。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 绑定保存与默认兼容

系统 SHALL 在设置按全局/工作区/分屏/终端展示现有26项绑定，保存于同一本机存储；macOS 主修饰键为 Command、Windows为Ctrl；已有自定义优先，不被新默认抢占，按钮和命令面板显示当前绑定。

#### Scenario: 升级新增快捷键

- **WHEN** 新增默认组合与已有自定义重合
- **THEN** 保留用户绑定优先级，并允许在设置重新分配。

### Requirement: 上下文与输入保护

系统 SHALL 锁屏、模态、录制、菜单、输入法组字和长按重复期间不执行相应操作；文件编辑器保留自身按键，普通输入只允许规定导航快捷键；Ctrl+C/Ctrl+D 等 shell 原行为默认保留。

#### Scenario: 输入法组字中按键

- **WHEN** 按键事件仍处于 composition
- **THEN** 不触发新建/关闭/分屏等工作区动作。

### Requirement: 面板和窗口范围

系统 SHALL 分屏基于当前聚焦面板并继承主机，切面板按布局树循环同步焦点；关闭面板只关该面板、关标签关闭整棵树且保护运行任务；独立窗口只执行其支持的当前窗口动作，不跨窗口执行主窗口快捷操作。

#### Scenario: 关闭当前分屏面板

- **WHEN** 用户在有多个面板的终端执行关闭面板
- **THEN** 仅关闭聚焦面板，保留同标签其他面板及任务确认流程。

## Sources and verification

- [keyboard-shortcuts](../../../docs/guides/keyboard-shortcuts.md)
