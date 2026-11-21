# Design

## Context

动机见 [proposal.md](proposal.md)。现有 `openspec/config.yaml` 使用 spec-driven，尚无主规格或既有变更。文档同时包含已实现、部分实施、待真实环境验收和纯提案。工作区有大量未提交实现，迁移以当前文件内容为输入，不从 HEAD 覆盖文档。

## Goals / Non-Goals

**Goals:** 一个约定只保留一个权威来源；每个原文段落有归属，读者能区分功能约定、待办和证据；之后可以按 OpenSpec 正常提案、实施、同步和归档。

**Non-Goals:** 不实现 VNC、原生窗口材质等功能，不补做实机验收，不重置既有任务状态，不重新决定视觉方向，不把所有技术说明强改成 SHALL。

## Decisions

### 1. 内容按职责拆分，采用中文正文和稳定英文路径

- `openspec/specs/<capability>/spec.md`：有现有依据的长期行为要求，使用 Requirement + SHALL/MUST 和 WHEN/THEN 场景，记录来源；不声称未经完成的验收已通过。
- `openspec/changes/<name>/`：范围明确的未来行为变更及其 proposal、delta specs、design、tasks。纯文档变更可按 schema 使用 skip_specs。待验收事项不能伪装成尚未实现的功能变更。
- `docs/guides/`：使用说明；`docs/architecture/`：技术实现；`docs/verification/`：验证记录及未决验收；`docs/history/`：带原始日期/状态的历史方案。
- `docs/design.md` 保持路径，界面强制清单迁到 `docs/design/interface-checklist.md`。规范在这两处维护，OpenSpec 只链接适用规则，避免双份视觉要求。
- `docs/README.md` 是文档导航、目录职责和完整迁移对照入口；不另建统一的大规格替代旧的大规格。

不采用“整个 features 原样搬到 openspec/specs”，因为混合提案与历史任务不满足当前主规格的语义；也不把所有历史文件自动放进 change archive，因为那会虚构 OpenSpec 生命周期与完成状态。

### 2. 逐文件迁移对照

下表主规格路径以 `openspec/specs/` 为前缀；记录路径以 `docs/` 为前缀。同一能力可以吸收多个来源，但保留分节来源和原状态。以下为实施目标，当前提案不创建这些目标文件。

| 原文件 | 长期要求归属 | 配套内容和状态处理 |
| --- | --- | --- |
| docs/design.md | 保留原路径 | 修正清单链接，保留跨编辑器强制规则 |
| docs/performance-reliability-audit-2026-11.md | 不直接转换为需求 | verification/performance-reliability-audit-2026-11.md，保留审计日期和剩余风险 |
| docs/terminal-output-flow-control.md | terminal-output/spec.md | architecture/terminal-output-flow-control.md；未完成的真实主机验收进入 verification/terminal-output.md |
| docs/terminal-tail-interrupt-0.6.30.md | 不直接转换为需求 | history/terminal-tail-interrupt-0.6.30.md；保留旧版本与当前工作区的区别 |
| features/artifactory-workspace.md | artifactory-workspace/spec.md | guides/artifactory.md；保留性能、安全与未来范围边界 |
| features/assistant-background-sessions.md | assistant-sessions/spec.md | guides/assistant-sessions.md；真实 JumpServer/原生验收单列 |
| features/assistant-docking.md | workspace-layout/spec.md | 布局与状态保留边界纳入主规格，隔离预览证据单列 |
| features/assistant-jumpserver.md | assistant-jumpserver/spec.md | guides/assistant-jumpserver.md；保留授权与真实连接判定 |
| features/assistant-model-config.md | assistant-model-config/spec.md | guides/assistant-model-config.md；协议/凭据约束保留，现有外部来源保留 |
| features/graphite-glass-theme.md | 不作为当前视觉要求 | history/graphite-glass-theme.md；标记已被柔和矿物/海玻璃方向取代 |
| features/graphite-glass-theme-tasks.md | 不创建产品要求 | history/graphite-glass-theme-tasks.md；保留勾选、未验收项与对应历史规格链接 |
| features/interface-redesign.md | 视觉约定仍由 docs/design.md 管理 | design/interface-checklist.md 保存强制清单；已做/待验收记录拆到 verification/interface-redesign.md |
| features/jumpserver-asset-workspace.md | jumpserver-workspace/spec.md | architecture/jumpserver-workspace.md；首版范围和远期目标分开 |
| features/keyboard-shortcuts.md | keyboard-shortcuts/spec.md | guides/keyboard-shortcuts.md；说明与约束不重复维护 |
| features/liquid-glass.md | 不进入当前行为基线 | changes/native-window-material/：未实现的可选增强，默认 CSS 玻璃与未来原生材质分开 |
| features/monaco-editor-integration.md | remote-editor/spec.md | architecture/remote-editor.md；保留生命周期/大小/TOFU边界，原生验收单列 |
| features/rdp-clipboard.md | rdp-clipboard/spec.md | architecture/rdp-clipboard.md；当前接入和 Windows Server 待验收分开 |
| features/rdp-implementation.md | rdp-workspace/spec.md | guides/rdp.md 与 architecture/rdp.md；安全说明、构建步骤和验证原样保留 |
| features/rdp-workspace.md | rdp-workspace/spec.md（仅当前 MVP） | history/rdp-research.md 保存比较依据；未实现阶段登记 backlog，明确范围后另行 propose |
| features/remote-explorer-enhancement.md | remote-explorer/spec.md | architecture/remote-explorer.md；A–E 实施结果与真实主机回归状态分开 |
| features/sftp-connection-library.md | sftp-connections/spec.md | guides/sftp-connections.md；已接入行为与未完成验收分开 |
| features/sftp-workspace.md | sftp-workspace/spec.md | guides/sftp.md；不把尚不支持的恢复/同步能力提升为承诺 |
| features/terminal-color-schemes.md | terminal-appearance/spec.md | guides/terminal-appearance.md；预设来源、应用配色与终端配色独立性保留 |
| features/terminal-performance.md | terminal-output/spec.md（仅核实的当前约定） | history/terminal-performance-plan.md 保存原始审计；当前限制链接新审计，余项进入 backlog/验收 |
| features/vnc-workspace.md | 不进入当前行为基线 | changes/vnc-workspace/：按原阶段保留未实现状态，Phase 5 标为可选 |
| features/webview-browser.md | webview-browser/spec.md | guides/browser.md；保留隔离、交互引用失效与待验收边界 |
| features/zmodem-jumpserver-transfer.md | terminal-file-transfer/spec.md（已接入 rz/sz） | architecture/terminal-file-transfer.md；未实现 JumpServer SFTP 定制进入 backlog |

主规格的合并边界是行为所有权，不是源文件数量；例如助手停靠与布局同属 workspace-layout，RDP 首版方案与实施说明合并为同一能力。

### 3. 任务状态、冲突与证据

原始 `[x]`、`[ ]`、`[~]` 状态与限定语保留；OpenSpec tasks 只采用受支持的复选框时，将 `[~]` 拆为已完成与剩余两个任务，附原始状态。验证记录分别标出实现、自动化、隔离预览、真实主机、macOS/Windows 原生验收，不用构建通过替代视觉或互操作验收。

冲突处理：当前明确的 AGENTS 和设计规则优先于标为历史的 Graphite 固定色值/尺寸；分屏数量、分离窗口关闭行为等旧文档描述，需与当前架构约定及实现核实，并在迁移记录写明依据。无法判定时标为冲突待决，不擅自改成 SHALL。不得新增“减少动态效果”等已被用户移除的规则。

### 4. 根目录入口和旧路径

- AGENTS 增加 OpenSpec 工作流、主规格/变更职责，更新设计清单路径；不移走架构与安全约束。
- README 保留产品、安装、构建入口，链接 docs 导航与 OpenSpec。
- spec.md 缩为主规格导航；tasks.md 缩为活动变更和未决验收导航。迁移前完整快照存入 history，明确不再维护。
- TODO 保留优先级与未排期 backlog，已转为独立 change 的条目只留状态和链接，避免两套可勾选任务。
- features 文件处理完后保留短导航页承接旧链接，禁止继续追加需求；没有任何内外部兼容价值的旧路径才可删除。历史锚点有引用时保留对应标题锚点或统一修复引用。
- `openspec/config.yaml` 补充简短项目上下文和文档规则；不复制设计全文，也不改变 schema 或引入工具依赖。

## Risks / Trade-offs

- [正文拆分导致语义丢失] → 逐文件迁移清单记录每个章节的目标、状态及来源；完成后比较原文与目标覆盖，禁止只按文件数量验收。
- [未发布改动被当成已发布行为] → 明确“当前工作区实现”与“发布/验收”，保留版本号与日期。
- [过多活动 change] → 仅为 VNC 与原生材质两个范围清楚的现有提案建独立 change；零散后续项仍归 backlog，确认范围后提案。
- [失效的相对路径和锚点] → 同时检查 Markdown 链接和代码路径文本，历史位置变化也修复，不只检查文件存在。
- [工作区修改被覆盖] → 基于当前内容编辑；不使用 checkout/reset，不借文档迁移修改实现。

## Migration Plan

1. 保存当前文档清单及根规格/任务快照，按对照表记录章节归属和状态。
2. 建立 docs 分类、导航和设计清单路径；更新引用后再替换旧路径为导航页。
3. 按能力逐一提炼现有主规格，补齐场景和来源，分离指南、技术方案、历史与验收证据。
4. 导入 VNC、原生材质未来 change，保留未完成任务；其他后续项集中到 TODO，链接来源。
5. 更新根入口和 OpenSpec context，运行格式、覆盖、状态保真与链接检查，以及所有主规格/变更校验。
6. 回退时只逆向本次文档移动和入口编辑，保留来源快照及用户其他改动；无应用数据或运行时迁移。
