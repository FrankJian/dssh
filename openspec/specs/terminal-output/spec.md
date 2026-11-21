# 终端输出与历史

## Purpose

分开约束已显示滚动历史和未解析实时积压，保持输入与通道隔离。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 显示历史行数

系统 SHALL 提供每终端 0–100000 行显示历史，默认 2000 行，不计当前屏幕且包括自动换行；超限自动淘汰最早已显示行，缩小立即生效，调大不恢复已淘汰内容；本机保存并同步现有实例和同源窗口。

#### Scenario: 设置为零

- **WHEN** 用户选择不保留输出历史
- **THEN** 只保留当前屏幕，命令继续运行，alternate screen 不被重置。

### Requirement: 消费后确认与有界投递

系统 SHALL 在 xterm write 回调完成解析后确认连续消费；每订阅单包最多 16 KiB UTF-8、在途最多 128 KiB/16 包、后端等待最多 4 MiB/512 事件；ACK 校验调用窗口、token 与实际发送边界，不丢任意 ANSI 字节继续解析。

#### Scenario: 伪造未来确认

- **WHEN** 后端收到未发送位置或旧订阅的 ACK
- **THEN** 拒绝释放当前订阅额度，其他窗口消费独立。

### Requirement: 明确过载与显式恢复

系统 SHALL 过载时只暂停该视图后续输出并提示部分输出未显示，保留已投递前缀；任务、输入和其他 channel 继续；显式恢复清屏后读取最近至多 200000 UTF-8 字节并建立新订阅，等待快照解析后接实时输出。

#### Scenario: 过载期间中断任务

- **WHEN** 用户在暂停视图按 Ctrl+C
- **THEN** 输入仍进入原 PTY 队列，不等待输出 ACK；该承诺不是远端进程必然结束的证明。

### Requirement: 历史与恢复边界

系统 SHALL 区分 xterm 滚动历史、后端有界原始历史、待解析队列和完整日志；历史回放抑制设备查询响应但允许 Ctrl+C；清屏恢复不宣称恢复任意 TUI 完整屏幕。

#### Scenario: 首次挂载无渲染器视图

- **WHEN** 未挂载视图已处理有界缓存后首次显示
- **THEN** 只回放保留历史，不假称恢复已淘汰日志或完整 TUI。

## Sources and verification

- [terminal-output-flow-control](../../../docs/architecture/terminal-output-flow-control.md)
- [terminal-output](../../../docs/verification/terminal-output.md)
- [performance-reliability-audit-2026-11](../../../docs/verification/performance-reliability-audit-2026-11.md)
