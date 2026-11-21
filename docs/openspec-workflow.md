# OpenSpec 使用流程

## 内容归属

- [specs](requirements.md)：当前行为约定和验收场景，不代表每项已发布或通过真实环境验收。
- `openspec/changes/<name>/`：需求变更的 proposal、delta specs、design 和 tasks。
- `openspec/changes/archive/`：完成实施、验证并按工作流归档的变更；旧 features 文档不会仅因迁移就放入此目录。
- [设计规则](design.md)、[文档导航](README.md)及[未排期 backlog](../TODO.md)保持独立职责。

## 工作流

1. 查看 `openspec list --specs`、`openspec list`，阅读相关主规格、TODO 与已有变更。
2. 新增或修改需求时执行 `/openspec-propose`，说明目标；生成范围、场景、设计和任务。提出方案不等于执行。
3. 用户要求实施后使用 `openspec-apply-change <name>`（或直接说明执行哪个变更），按 tasks 推进，记录验证证据。
4. `openspec validate <name> --type change --strict` 校验变更；实现和验收完成后检查主规格同步。需要单独同步时使用 `openspec-sync-specs`，归档时使用 `openspec-archive-change`。
5. 归档只针对真正完成的变更；未完成验收和可选后续范围必须明确处理，不把文档导入当作功能完成。

能力与变更同名时，`openspec show` / `validate` 明确传 `--type spec` 或 `--type change`。只看当前状态使用 `openspec status --change <name>`；实际执行进度看 `openspec instructions apply --change <name> --json`，planning complete 不代表 tasks complete。

## 当前变更

| 变更 | 文档 | 状态 |
| --- | --- | --- |
| VNC 工作区 | [proposal](../openspec/changes/vnc-workspace/proposal.md) · [tasks](../openspec/changes/vnc-workspace/tasks.md) | 尚未实现；31 项未完成，Phase 5 可选 |
| 原生窗口材质 | [proposal](../openspec/changes/native-window-material/proposal.md) · [tasks](../openspec/changes/native-window-material/tasks.md) | 原生能力尚未实现；已完成项仅为 CSS 基线，Phase 6 可选 |

纯文档整理不新增产品行为时可设置 `skip_specs: true`，不要为通过校验虚构需求。主规格首次导入有依据的已有行为属于建立基线；未来行为继续用 change 的增量规格管理。

## 已归档变更

- **2026-11-21 文档迁移**： [proposal](../openspec/changes/archive/2026-11-21-migrate-docs-to-openspec/proposal.md) · [tasks](../openspec/changes/archive/2026-11-21-migrate-docs-to-openspec/tasks.md)；20/20 任务完成，spec-driven，无增量规格待同步。
