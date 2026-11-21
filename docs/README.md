# Duo SSH 文档

需求与变更使用 OpenSpec 管理，正文以中文为主。包名 `dssh` 保持不变。

## 从这里开始

- [当前需求基线](requirements.md)：按能力查行为要求和场景。
- [变更与工作流](openspec-workflow.md)：新增或修改需求从 propose 开始，实施后同步并归档。
- [界面设计规范](design.md)与[每次界面改动清单](design/interface-checklist.md)：所有编辑器和代理必须遵守。
- [未排期待办](../TODO.md)：优先级、限制和明确延后项；待验收记录见下表。
- [迁移检查与冲突处理](verification/documentation-migration-2026-11-21.md)。

## 目录职责

`openspec/` 只放 OpenSpec 配置、能力规格和按流程生成的变更/归档产物；自定义导航、使用说明和索引统一放在 `docs/`。

| 位置 | 内容 |
| --- | --- |
| `openspec/specs/` | 当前行为要求；修改行为先提出 change |
| `openspec/changes/` | 待实施、实施中和待归档的独立变更 |
| `docs/guides/` | 用户操作步骤与说明 |
| `docs/architecture/` | 技术结构、接口与实现依据 |
| `docs/verification/` | 检查证据、真实环境待验收与边界 |
| `docs/history/` | 不再作为当前要求的旧方案及迁移前快照 |

说明和历史记录不另行维护一套行为承诺。已实现、已发布和实机验收是三个不同状态；历史勾选只说明当时记录，不证明当前完整验收。

## 按内容查阅

- [使用指南](guides/README.md)：连接、文件工作台、终端配色、快捷键及助手的操作说明。
- [架构与实现](architecture/README.md)：接口、安全边界、生命周期和实现依据。
- [验证与待验收](verification/README.md)：测试环境、检查结果、证据局限和缺少的实机验收。
- [历史记录](history/README.md)：旧方案与只读快照。

## 迁移记录

原文档的完整来源、状态和章节去向集中在 [逐章节迁移对照](history/documentation-migration-map-2026-11-21.md)，日常查阅使用上面的现行入口。
