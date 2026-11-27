# 统一侧栏详情：本机代码验证

2026-11-27；变更与剩余工作以 [unify-sidebar-details](../../openspec/changes/unify-sidebar-details/tasks.md) 为准。代码已接入并完成下述 Chrome 交互与视觉检查；原生安装包验收未完成，未发布。

实际执行：

- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit`：通过。
- `pnpm --config.verify-deps-before-run=false build`：通过；Vite 提示部分产物超过 500 kB，非本次侧栏错误。
- `node --experimental-strip-types --test src/app/*.test.mjs src/editor/*.test.mjs src/ssh/connectionFolders.test.mjs src/sftp/sftpLibrary.test.mjs`：132/132 通过。
- `node --test tests/sidebar/render.test.mjs`：4/4 通过。直接服务端渲染生产 ActivityBar、useSidebarDetails、连接分类、工具目录、Artifactory、编辑器侧栏和终端文件分栏；验证首位唯一入口、展开名称/状态、无详情页面禁用、偏好初始化、隐藏容器以及受控模式无重复揭示按钮。不启动浏览器、不调用原生或远端服务，不证明鼠标/键盘/像素布局正确。
- `openspec validate unify-sidebar-details --type change --strict --no-interactive`、`git diff --check`：通过。

CodeGraph 定位后审阅 App 的折叠状态写入和实际表面优先级；连接管理、工具、S3、Artifactory 优先于后台编辑器/浏览器标签；会话外壳中的编辑器、浏览器、终端文件树分别对应自身详情、无详情、文件树。JumpServer 可见性沿 Workspace → Platform → AssetDirectory 传递。右侧助手/主机工具和编辑器问题面板保持各自状态。

## Chrome 实际交互与视觉证据

用户授权后，通过 CUA 原生界面操作 Chrome 新建的本机测试标签；页面为 `tests/sidebar/index.html`，直接挂载生产 App，模拟全部 Tauri IPC（包括浏览器标签通知、编辑器文件和 JumpServer 身份/授权目录），不访问真实凭据、文件或远端服务器。最初的窗口连接障碍已经消除。

- 依次验证连接管理、工具箱、SFTP、S3、Artifactory、会话、编辑器：收起后切换仍收起；展开后无其他功能的残留侧栏。重复选择工具箱不改变折叠状态。
- 刷新测试页面后仍保持收起。浏览器显示“当前页面没有侧边栏详情”的禁用按钮；返回连接管理保持原偏好。
- JumpServer 连接展开自身授权目录（合成“验收目录”），收起后目录从可访问树消失，主表面保留。
- 编辑器没有重复的工具栏折叠按钮或外层会话树。打开目录保持收起；显式目录搜索和面包屑定位文件会展开对应详情。收起/展开、跨功能返回后合成未保存文本 `Draft preserved Hello sidebar` 仍保留。
- Enter 可操作首位按钮。Tab 可以聚焦文件树分隔线，Home 折叠后焦点回到首位按钮；Enter 再展开恢复 240px。
- 实际拖动发现分隔线移位后释放事件未完成、停留零宽预览的问题；改为在 window 捕获阶段接收拖动/释放/取消，并在隐藏时清理。原操作复测：折叠状态同步，焦点回到统一按钮，再展开恢复 240px，草稿保留。
- 检查深色默认配色工具箱、浅色自定义 `#7b68b4` 连接管理/编辑器截图；按钮边框、方向、状态和分隔清晰。Chrome Responsive 900×700 视口下，连接管理收起后正文使用释放宽度，无空白侧栏列；普通宽窗口也已观察。

复现入口：`pnpm --config.verify-deps-before-run=false exec vite --mode sidebar-qa --host 127.0.0.1 --port 1431`，Chrome 打开 `http://127.0.0.1:1431/tests/sidebar/?theme=dark`；`theme=light&color=%237b68b4` 查看浅色自定义配色。`reset` 参数仅清理该测试源的折叠偏好，刷新持久化检查不要携带它。该源只用于模拟验收。

边界：浏览器默认快捷键可能被 Chrome 自身截获，本次未把浏览器检查视为原生快捷键验收。Windows/macOS 安装包、独立原生窗口、多 DPI、真实 JumpServer/SSH、减少透明度/系统高对比尚未验证；由发布前实机验收补齐。

本机 pnpm 默认会先校验并尝试安装当前工作区依赖；非交互执行曾被中止。后续使用单次命令参数关闭运行前自动依赖校验，沿用现有 node_modules；未重新安装或修改仓库包管理配置。

## 侧栏动效补充验收（2026-11-27）

原先多数详情使用 hidden/display:none，且外壳折叠时卸载内容，导致视觉直接跳变。现保留详情 DOM，用注册数值属性连续驱动宽度/高度、间距和透明度；inert/aria-hidden 立即隔离交互，visibility 在 150ms 后隐藏。系统减少动态效果时不插值；编辑器拖宽时不加入过渡延迟，旧终端文件树过渡期间合并 fit。

实际通过 CUA 点击生产 App 首位按钮，`?motion` 测试页只读采样 computedStyle/getBoundingClientRect，不自动操作产品。Chrome 采样结果：

| 详情 | 观察到的中间帧/尺寸 | 最终状态 |
| --- | --- | --- |
| 会话 | 17 个中间帧，19 个不同尺寸 | 收起宽度 0px |
| 工具箱 | 展开/收起各 17 个中间帧，18–19 个不同尺寸 | 展开 217px，收起 0px |
| SFTP | 17 个中间帧 | 展开进度 1 |
| S3 | 17 个中间帧 | 展开进度 1 |
| Artifactory | 17 个中间帧，19 个不同尺寸 | 展开 208px，收起 0px |
| 编辑器 | 17–18 个中间帧，19 个不同尺寸 | 展开 240px，收起 0px |
| JumpServer 授权目录 | 17 个中间帧 | 展开进度 1；窄布局收起进度 0 |

快速双击反向切换最终回到正确展开状态，中间帧仍存在。Chrome 250% 缩放触发窄容器布局，工具目录及 JumpServer 目录收起不再留纵向占位。浅色和深色自定义紫色截图已检查。

通过 DevTools 的 Rendering 命令模拟 prefers-reduced-motion: reduce（仅测试标签）：收起工具目录时中间帧为 0，最终进度 0，matchMedia 为 true；退出模拟后再次展开恢复 17 个中间帧。已关闭开发者工具、恢复 100% 缩放并关闭本次测试标签。

新增服务端回归验证：详情关闭时 DOM 保留、inert/aria-hidden 正确、没有 hidden 属性中断过渡；外壳内容和网格轨道保持一致。生产构建、类型检查、侧栏与布局/编辑器相关回归通过。旧终端文件分栏仅做组件渲染/代码检查，未连接实际终端测量 fit 频率；Windows/macOS 安装包与独立原生窗口仍待发布前验收。
