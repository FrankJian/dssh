# Proposal

## Why

原 `features/liquid-glass.md` 定义可选的原生窗口材质，尚未实现；默认应用内玻璃已是现有能力。单独管理这个变更可避免把桌面透视的风险与当前配色、布局或默认 CSS 材质混为一谈。

## What Changes

- 新增默认关闭的 off/window 原生材质偏好与独立强度，支持能力探测和跨窗口同步。
- 在可行性验证通过后，由 Rust 为支持的平台施加系统材质，保留实色/减少透明度降级。
- 先验证透明窗口行为、启动闪烁和性能，失败时修订方案再决定是否发布。
- Phase 6 的 macOS 私有材质探索保持可选，不进入默认实现或发布门槛；导入不启动实现。

## Capabilities

### New Capabilities

- `native-window-material`：原生桌面透视的能力、模式、降级、同步及内容隔离。

### Modified Capabilities

无。当前应用配色、终端方案及默认 CSS 玻璃保持原语义。

## Impact

未来影响 Tauri 窗口创建、平台材质命令、设置偏好、独立窗口和发布/性能验证。原设计中的 Graphite 色值和旧控件类仅作历史基线，界面实现统一遵守 [设计规范](../../../docs/design.md)。详见 [design.md](design.md)、[tasks.md](tasks.md)。
