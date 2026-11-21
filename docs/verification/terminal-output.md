# 终端输出消费确认与过载保护

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> 来源：`docs/terminal-output-flow-control.md`，整理于 2026-11-21。保留原文时间与验收限定语。


## 验证

- Rust：停滞消费者的输出包/字节/等待队列上限、只提示一次暂停、陈旧/伪造 ACK、Unicode/ANSI 和状态顺序、其他窗口独立消费、累计 64 MiB 已确认输出后队列归零，以及输出过载后 Ctrl+C 仍可进入 PTY 输入队列。
- 前端：消费完成顺序、ACK 合并、解析失败不确认、早到数据、暂停/状态交接、恢复期间再次过载、等待替换屏幕完成后才接实时输出。
- 使用实际安装的 xterm 公共 API，经过消费确认链路解析 **64,000,000 字符**，未确认写入始终不超过 128 KiB；积压未清空时 `terminal.input("\x03", true)` 能触发 onData。该测试是无 DOM 解析器集成，不是远端 SIGINT 或 Windows UI 延迟证明。
- 隔离浏览器挂载真实 terminalRegistry/xterm，验证常驻暂停提示、暂停期间普通键盘输入、清屏恢复和焦点返回。测试按钮模拟暂停，未调用实际 SSH 后端；浏览器自动化的 Control+C 没有产生页面 keydown，故未用它宣称原生 Ctrl+C 已通过。临时页面与 Vite 服务已清理。
- TypeScript、生产构建、cargo fmt、clippy（all-targets / -D warnings）通过；完整前端回归 267 项通过，Rust 230 项通过、1 忽略，含 doc-test 阶段。

发布前仍需 Windows 正式包、真实 SSH/JumpServer、稳定低速隔夜和高速突发、后台窗口节流、多窗口/分屏、Ctrl+C 按键回显/远端进程状态、峰值 RSS 与输入延迟验收。不能把本次有界队列和 API 测试等同于已复现并修复 0.6.30 用户的全部现场故障。

<a id="scrollback-verification"></a>

回归覆盖默认/0/损坏偏好、保存失败、storage 同步、实际 xterm 的滚动上限动态缩减与 TUI 保留。隔离浏览器挂载真实设置组件和 terminalRegistry：两个标签共四个终端验证 2,000→10→50→0 即时更新、持续追加仍受上限约束、负数拒绝、恢复默认和新窗口继承。完整原生多窗口验收仍待随发布包验证。
