# Proposal

## Why

目前 `docs/` 的 4 份文档与 `features/` 的 23 份文档混合了承诺、实施方案、历史调研和验收记录，根目录另有重复的规格与任务。采用 OpenSpec 管理需求及变更，让当前约定、未来工作和历史证据有明确入口，避免旧设计被当成新要求。

## What Changes

- 逐文件拆分和迁移现有 27 份文档，保留原文来源、任务状态、技术边界与验收证据。
- 将稳定行为需求归入 `openspec/specs/<capability>/spec.md`；未来需求进入独立的 `openspec/changes/`，通过 proposal、design、specs、tasks 管理。
- 将使用指南、架构说明和审计记录归入 `docs/` 的对应目录；保留跨编辑器设计规则路径 `docs/design.md`。
- 以 `docs/README.md` 建立导航和迁移对照；更新 AGENTS、README、根目录 spec/tasks/TODO 的入口与职责，移除重复需求维护点。
- 保留必要的旧路径导航页，修复移动造成的文档、代码和锚点链接。历史文档不伪装成已完成的 OpenSpec change。
- 仅整理文档和工作流，不改变应用功能、设计决策、发布状态或已有验收结论。

## Capabilities

### New Capabilities

无。本次是现有文档的迁移和需求基线整理，不新增软件行为；使用 `skip_specs: true`，不为通过校验虚构产品需求。实施时提炼的主规格仅记录现有有依据的约定。

### Modified Capabilities

无。当前尚无 OpenSpec 主规格；原文之间的冲突必须显式记录，不能借迁移修改产品要求。

## Impact

- 文档：`docs/`、`features/`、`AGENTS.md`、`README.md`、`spec.md`、`tasks.md`、`TODO.md`。
- OpenSpec：补充项目上下文、现有能力主规格及明确未实现需求的变更目录。
- 不改 `src/`、`src-tauri/`、依赖、凭据、数据库及构建产物；保留工作区已有改动。
- 完成条件：27 个源文件全部有内容去向、任务与验收状态可追溯、链接可用，未来需求不混入当前行为基线。
