# keyboard-shortcuts 验证记录

> 迁自使用/实现说明；证据等级与未完成状态保留原记录，不因迁移补做任何验收。


<a id="shortcuts-verification"></a>

验证：`pnpm test:shortcuts` 在独立 macOS / Windows 平台环境验证默认绑定无冲突、自定义与重置、应用按键交接、输入法 / 长按 / 弹窗 / 编辑场景及循环顺序。浏览器隔离预览使用实际 xterm、PaneGrid 与统一分发 hook 验证左右 / 上下分屏、焦点切换、按键未写入 shell、输入框与弹窗阻止执行。浏览器自身保留的组合键用仅作用于预览的临时绑定验证，不改动用户配置。Windows 与原生独立窗口实际键盘验收仍待完成。
