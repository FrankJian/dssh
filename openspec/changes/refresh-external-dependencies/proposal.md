## Why
用户要求全面核对并更新外部依赖。npm、crates.io 和上游发行记录显示应用框架、编辑器、SSH、RDP、构建工具均有稳定更新。

## What Changes
- 更新可兼容的直接/间接依赖、锁文件与固定原生源码校验值；必要时适配 API。
- 核对工具链与 CI 依赖，运行前端、Rust 和 RDP 回归。
- 对需要改变凭据存储等行为的跨版本迁移记录具体保留原因，不以更新之名改变配置和授权语义。

## Capabilities
无新增产品行为；`skip_specs: true`，本次是依赖维护与兼容适配。

## Impact
package.json、pnpm/Cargo 锁文件、Rust 清单、原生 RDP 适配和 CI 工具；验证证据见依赖更新记录。无产品版本号变更。
