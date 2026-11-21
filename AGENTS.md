# Duo SSH Agent Guide

## 技术栈与工具

- 面向 Windows/macOS；React 19、TypeScript、Vite、Tauri 2、Rust（edition 2024）。前端使用 `pnpm`，Rust 使用 stable 工具链。
- 产品名称使用 Duo SSH；内部包名、存储键和兼容标识不得因文案调整而随意更名。

## 编码行为

- 实施前阅读相关需求、已有变更和 `TODO.md`，避免重复实现已延后的工作；功能现状以规格与源码为准。
- 修改范围围绕用户目标，保留工作区已有改动；不编辑 `dist/`、`src-tauri/target/` 等生成产物。
- 仓库已被 CodeGraph 索引时，先用它定位和理解代码；未索引时不要自行创建索引。
- 遵守模块职责与已有服务边界；修改 Tauri 契约时同步 Rust DTO、TypeScript 类型和服务层，载荷使用 camelCase。
- 持久化变更使用编号迁移并保持旧数据库兼容；不得未经需求确认改变已有配置的保存或导入导出语义。
- 错误处理沿用 `AppError` 与服务层规范，避免向用户展示未经处理的内部错误。
- 禁止将真实密码、私钥、令牌或其他秘密写入日志、测试样本、文档或提交；不得绕过主机身份验证和既有授权流程。
- 远端命令及破坏性 AI 操作必须保留显式用户批准；安全与会话归属约束见相关架构文档和规格。
- 所有界面改动（含小修复）必须先阅读并遵守设计规范及强制清单；不要在本文件复述视觉规则。

## 需求与文档纪律

- 新增或改变行为使用 OpenSpec 变更；按所选工作流执行，进度维护在该变更的任务文件。流程细节查文档索引。
- `openspec/` 只放 OpenSpec 配置、规格、流程产物及归档；自定义 README、索引和辅助说明放在 `docs/`。
- 每项需求或任务保持单一维护来源；不在导航、历史快照或验收记录中新增重复的需求与实施清单。
- 区分实现、发布和真实环境验收；未完成项如实保留，不以模拟测试或构建通过代替实机验证。
- `AGENTS.md` 只维护长期执行规则、技术栈、文档索引和命令用途；现状清单、临时进度、算法/事件机制与常量放到对应规格或文档。

## 文档索引

| 内容 | 权威入口 |
| --- | --- |
| 产品说明与构建指南 | [README.md](README.md) |
| 文档导航 | [docs/README.md](docs/README.md) |
| 行为规格 | [需求索引](docs/requirements.md) → `openspec/specs/` |
| 需求变更与任务 | [OpenSpec 使用流程](docs/openspec-workflow.md) → `openspec/changes/` |
| 未排期与明确延后事项 | [TODO.md](TODO.md) |
| 工程组织、工作区与数据边界 | [工程架构](docs/architecture/project-structure.md) |
| SSH 传输、身份与凭据边界 | [SSH 架构](docs/architecture/ssh-transport.md) |
| 其他模块实现依据 | [架构索引](docs/architecture/README.md) |
| 界面规则 | [设计规范](docs/design.md)、[强制清单](docs/design/interface-checklist.md) |
| 验证证据与局限 | [验收索引](docs/verification/README.md) |
| 历史决策与来源 | [历史索引](docs/history/README.md) |

## 验证要求与命令用途

前端改动运行类型检查、生产构建及相关模块回归；Rust 改动运行格式、严格 Clippy 和测试。界面改动还须按设计清单验证。纯文档改动检查受影响链接和格式，涉及 OpenSpec 产物时运行对应校验。报告实际执行结果及未验证范围。

命令默认在仓库根目录运行；Rust 命令在 `src-tauri/` 运行。模块测试脚本以 `package.json` 为准，CI 约定以 `.github/workflows/ci.yml` 为准。

| 命令 | 用途 |
| --- | --- |
| `pnpm exec tsc --noEmit` | 前端类型检查 |
| `pnpm build` | 前端生产构建校验 |
| `pnpm test:sftp`、`pnpm test:ai-config` 等相关脚本 | 模块回归测试 |
| `pnpm tauri dev` | 原生开发环境与界面验证 |
| `cargo fmt --check` | Rust 格式检查；需修正时运行 `cargo fmt` |
| `cargo clippy --all-targets -- -D warnings` | Rust 严格静态检查 |
| `cargo test` | Rust 测试 |
| `openspec context --json` | 确认操作所用的 OpenSpec 根目录 |
| `openspec list`、`openspec list --specs` | 查询变更与能力规格 |
| `openspec validate --all --strict --no-interactive` | 校验活动变更与主规格 |
| `openspec validate --archived --strict --no-interactive` | 校验归档任务完成状态 |
