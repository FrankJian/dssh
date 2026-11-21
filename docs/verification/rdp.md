# RDP 首版实施说明

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> [迁移记录（2026-11-21）](../history/documentation-migration-map-2026-11-21.md)；保留原文时间与验收限定语。


## 检查与测试

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm test:rdp
pnpm test:rdp-worker
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

原生边界测试使用本机临时 TLS 探针，无真实 Windows / 凭据：覆盖协议长度上限、启动前 / 连接中父进程消失、未知 CA 拒绝、正确 pin 进入 CredSSP，以及已被 CA 信任的不同证书仍因错误 pin 被拒绝；显式跳过验证时，自签名和名称不匹配可继续进入 NLA 协商。新增移目录、清理环境、禁用外部 provider 后的 NTLM 加密公开向量自检。测试需要 loopback bind 权限和 openssl CLI；仅缺少该 CLI 时跳过 TLS 探针，Windows 也按实际生产的 CREATE_NO_WINDOW 启动方式验证。

本次 macOS 已通过 Rust 138 项测试（另 1 项按原有规则忽略）、TypeScript / 生产构建、3 项前端状态回归、7 项原生构建回归、5 项原生边界测试，并生成包含 worker / 动态库的隔离 app bundle。原生界面已验证创建配置、一次性密码提交、启动真实 worker、不可达地址错误与手动重连入口；隔离配置使用独立 app identifier，没有读取用户原有连接配置。证书跳过选项另已覆盖旧配置默认严格验证、开启 / 关闭持久化、保留 NLA、指纹恢复及原生自签名 / 名称不匹配的协议回归；该选项尚需真实 Windows Server 验收。

前端回归覆盖迟到事件不复活已结束会话、并发事件不被旧快照删除，以及失败状态不被旧快照覆盖。Rust 覆盖配置验证、严格密码更新请求、迁移幂等与公开 DTO 隐藏 secret reference。

这些检查不能证明真实 Windows 桌面互操作已经通过。当前没有真实 Windows Server 验收结果，Windows native 构建也需由对应 CI / 实机确认；必须继续按 TODO 的长稳、输入、证书、凭据库和安装矩阵验证。Homebrew / vcpkg 的原生依赖基线及实际最小系统版本还需要发行验证：CMake 的 deployment target 不会降低已有第三方库的系统要求，本机开发包不代表支持旧版 macOS。
