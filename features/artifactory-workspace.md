# Artifactory 构件工作台

## 目标与已实现范围

在左侧活动栏提供可隐藏的 Artifactory 入口，默认隐藏，由“设置 → 外观 → 左侧导航栏”开启。用户可保存多个 JFrog Platform 连接，以 Access Token 认证。连接 URL 接受平台根路径或以 `/artifactory` 结尾的路径。Token 仅在新建或更新时写入 Rust 侧，读取配置时只返回 `hasToken`。

支持列出当前 Token 可访问的仓库，按需逐层展开目录，查看文件/目录基础元数据、校验和及自定义属性；批量选择本地文件上传到当前目录，下载远端文件，或将本地/缓存仓库的目录及仓库根目录下载为 ZIP。可添加、修改、移除当前项的多值属性。上传同名文件前明确提示覆盖；删除连接仅删除本地配置及 Token，不删除远端数据。

## 布局与交互

- 三列工作台：连接/仓库导航、文件列表、详情。窄窗口隐藏详情列。表格和文件内容保持不模糊。
- 连接区支持新建、编辑、删除；仓库区支持即时本地筛选。仓库列表显示类型，工作区标题显示仓库包类型。
- 目录用面包屑导航，双击目录进入，单击选中并请求详情。刷新只重新请求当前目录。加载、空目录、认证/权限/网络错误分别给出状态及重试入口。
- 上传支持一次选择多个本地文件；下载使用系统保存对话框。传输队列显示进度、结果与错误，支持取消、重试及清除已结束任务；同时最多执行 2 项，最多保留 200 项，切换 Artifactory 页面后队列继续运行。
- 属性面板可直接添加和编辑多值属性；删除须确认。通过 Metadata PATCH API 更新，统一使用 `recursiveProperties=0`，防止目录编辑意外影响其子项。

## 性能和安全边界

- `GET /artifactory/api/repositories` 仅在打开连接时请求；目录使用 `GET /artifactory/api/storage/{repo}/{path}` 的直接子项，不执行全库递归扫描。路径切换时忽略过期响应。
- 上传以流式请求体发送，下载按网络分块写入同目录临时文件，成功后重命名；失败清理临时文件。HTTP 重定向关闭，避免 Bearer Token 跟随重定向。
- 队列任务在 Rust 进程内运行，页面切换时保留；关闭应用后不恢复未完成任务。文件下载不支持断点续传，取消后删除临时文件。上传进度表示已读取/送入请求体的字节，不代表服务器已确认完成。
- ZIP 目录下载调用 JFrog 的归档 API，需要 Artifactory Pro、启用 Folder Download、读取权限及允许的 Xray 策略，仅支持本地或缓存仓库。属性编辑需要 Artifactory Pro 和 Annotate 权限，支持本地或缓存仓库。服务端能力或权限不足会以任务失败呈现。
- 所有网络请求和 Token 解析在 Rust 中执行。后端校验 URL 与仓库/文件路径，错误不回显 Token 或远端响应体。使用现有 `app_secrets` SQLite 机制；统一钥匙串迁移仍按 TODO 的 P1 项执行。
- HTTP URL 仅建议用于可信网络；TLS 证书仍由系统信任链校验。

## 后续演进与取舍

建议按以下顺序演进：

1. **跨目录搜索**：用 AQL 按仓库、名称、属性筛选，结果分页和限制返回字段；避免全库递归加载。AQL 的查询大小与权限受服务端限制，初版应限制为已选仓库。
2. **复制/移动构件**：先支持服务端 dry run，再明确目标路径、覆盖结果和权限。复制 API 需要 Artifactory Pro；移动和删除属于远端变更，交互需确认。
3. **传输恢复**：为超大文件设计可持久化的任务及分段/断点协议，确认服务端支持和跨平台恢复语义后再接入。

批量删除和目录级递归属性修改容易产生大范围远端影响，暂不放入默认操作。大文件及目录下载仍需真实 Artifactory 与 macOS/Windows 原生窗口验收。

参考：[存储项信息 API](https://docs.jfrog.com/artifactory/reference/getstorageitem)、[目录归档 API](https://docs.jfrog.com/artifactory/reference/retrieveFolderOrRepositoryArchive)、[更新属性 API](https://docs.jfrog.com/artifactory/reference/updateitemproperties)、[AQL](https://docs.jfrog.com/artifactory/reference/searchaql)、[复制项 API](https://docs.jfrog.com/artifactory/reference/copyitem)。
