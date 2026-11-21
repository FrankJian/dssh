# 远程文本编辑器

## Purpose

Monaco 仅承接文本编辑，文件管理和安全仍属于原 SFTP 路径。

本文记录 2026-11-21 工作区已有行为约定；不表示所有平台或真实服务已验收。

## Requirements

### Requirement: 编辑职责与懒加载

系统 SHALL 首个文本读取成功后按需加载官方 ESM Monaco 与 worker，保持目录树、文本/Markdown/图片分支、标签和 TOFU；不引入 VS Code Workbench、远端 LSP、调试器或扩展。

#### Scenario: 打开未知扩展名

- **WHEN** SFTP 读取一个受支持大小的未知类型文本文件
- **THEN** 以 plaintext 编辑，不自动启动远端语言服务。

### Requirement: 模型隔离与保存保护

系统 SHALL 按 profile/绝对路径及实例隔离 Monaco model，跟踪 dirty，只有显式保存才写远端；保存失败保留内容，关闭遵循保存/放弃/取消，标签关闭、profile 切换或销毁后释放 model 和订阅。

#### Scenario: 远端保存失败

- **WHEN** 用户保存未提交文本时服务端拒绝
- **THEN** 保留 model 与 dirty，展示错误，不关闭标签或虚报保存。

### Requirement: 兼容与验证范围

系统 SHALL 沿用后端 1 GiB 文本上限，主题映射语义 token，保持字体/换行等已有设置；开发服务器 worker 正常不代表打包 WebView 正常，打包产物仍需两平台输入法、worker 与无障碍验收。

#### Scenario: 更换应用配色

- **WHEN** 用户在已打开编辑器时改变深浅或应用颜色
- **THEN** 更新编辑器语义主题并保留正文、光标和未保存状态。

## Sources and verification

- [remote-editor](../../../docs/architecture/remote-editor.md)
- [remote-editor](../../../docs/verification/remote-editor.md)
