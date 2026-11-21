# Tasks

## 1. 迁移清单与设计规范

- [x] 1.1 按 design 的 27 文件对照建立 docs/README.md 迁移登记，逐章节标注去向与原状态；核对 docs/features 源文件清单无遗漏。
- [x] 1.2 保存根 spec.md、tasks.md 原始快照到 docs/history，并记录来源日期；比较快照与迁移前正文一致，保持已有工作区内容。
- [x] 1.3 保留 docs/design.md，迁移界面规范及清单到 docs/design/interface-checklist.md，实施/验收内容分离到 docs/verification/interface-redesign.md；逐条核对设计约束未丢失，链接与强制执行入口可用。

## 2. 当前行为主规格与配套记录

- [x] 2.1 迁移终端配色、性能与流控文件，建立 terminal-appearance、terminal-output、terminal-file-transfer 主规格及对应指南/架构/历史/验收记录；核对每条要求有来源和场景，Ctrl+C 版本结论、未解析 ANSI、历史上限与过载边界均保留。
- [x] 2.2 迁移助手会话、停靠、JumpServer 和模型配置，建立 assistant-sessions、workspace-layout、assistant-jumpserver、assistant-model-config 主规格及指南；核对后台接管/批准/凭据约束与真实验收状态完整保留。
- [x] 2.3 迁移 SFTP 连接库、双栏工作台、Explorer 与 Monaco，建立 sftp-connections、sftp-workspace、remote-explorer、remote-editor 主规格及配套文档；核对未保存状态、传输取消、文件限制和不支持能力未变。
- [x] 2.4 合并 RDP 首版方案与实施说明，建立 rdp-workspace、rdp-clipboard 主规格和指南/架构/历史记录；逐项核对证书、凭据、剪贴板和待 Windows Server 验收约束。
- [x] 2.5 迁移 Artifactory、JumpServer 资产、浏览器、快捷键，建立 artifactory-workspace、jumpserver-workspace、webview-browser、keyboard-shortcuts 主规格及配套文档；检查原文安全/权限/隔离边界和来源完整。
- [x] 2.6 归档 Graphite 规格及任务、性能审计与旧版本 tail 排查到 docs 对应目录；保留日期、勾选和原始限制，明确历史记录不会覆盖当前设计，检查所有移动文件的链接与锚点。
- [x] 2.7 每批主规格编写后立即运行对应 OpenSpec spec 校验，并更新 docs/README.md 章节覆盖登记；以源文与目标逐节对照确认无要求遗漏，不以文件存在替代语义检查。

## 3. 未实现需求与验收归属

- [x] 3.1 将 VNC 提案导入 vnc-workspace 独立变更的 proposal/design/delta specs/tasks，保留全部阶段未完成及可选 Phase 5；逐项对照原文和根 tasks，运行变更校验且不归档。
- [x] 3.2 将原生材质提案导入 native-window-material 独立变更，保留默认 CSS 玻璃与未来原生材质的区别；核对未实现状态和降级要求，运行变更校验且不归档。
- [x] 3.3 将真实主机、原生窗口、macOS/Windows 验收收敛到 docs/verification，保留证据类型与未完成状态；对照原 [x]/[ ]/[~] 和限定语，确认未把隔离验证写成真实验收。
- [x] 3.4 将 JumpServer SFTP 定制、RDP 后续阶段等未确定变更保留在 TODO backlog，已建 change 仅留链接；确认无双份可勾选任务、无未实现行为被写入当前主规格。

## 4. 入口与工作流

- [x] 4.1 更新 AGENTS、README 与 docs/README，说明读取主规格、提出变更、实施、同步及归档的工作流，修正设计清单路径；逐一检查入口能找到权威内容，保留既有安全与架构要求。
- [x] 4.2 将根 spec/tasks 缩为导航，features 旧文件改为必要的迁移入口；对照完整快照和迁移登记核对正文、代码路径与已知历史锚点均有可用去向。
- [x] 4.3 补充 openspec/config.yaml 项目上下文及文档规则，保留 spec-driven 和本地根配置；运行 openspec context/status 确认解析正确，不复制整份设计规范。

## 5. 整体验收

- [x] 5.1 检查 27 个源文件的章节覆盖、状态保真及根文档迁移记录；交付无遗漏清单与显式冲突记录，不能将不确定描述静默转为正式要求。
- [x] 5.2 检查全仓 Markdown 相对链接、文件目标和标题锚点，区分已有问题与迁移回归；确认本次无新增失效引用，并运行所有新增主规格/变更的 OpenSpec 校验。
- [x] 5.3 检查 git diff 与文档导航，确认本次只涉及文档和 OpenSpec 配置、无实现/凭据/生成产物改动，记录实际执行的检查结果。

## Workflow follow-up

- 整理完成并满足项目审阅要求后再归档本迁移变更；VNC 与原生材质变更继续保持待实施状态。
