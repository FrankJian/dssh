# Artifactory 构件工作台

## 目标与首版范围

在左侧活动栏提供可隐藏的 Artifactory 入口，默认隐藏，由“设置 → 外观 → 左侧导航栏”开启。用户可保存多个 JFrog Platform 连接，以 Access Token 认证。连接 URL 接受平台根路径或以 `/artifactory` 结尾的路径。Token 仅在新建或更新时写入 Rust 侧，读取配置时只返回 `hasToken`。

首版支持：列出当前 Token 可访问的仓库；按需逐层展开目录；查看文件/目录基础元数据、校验和及自定义属性；选择本地文件上传到当前目录；选择远端文件下载到本地。上传同名文件前明确提示覆盖。删除连接仅删除本地配置及 Token，不删除远端数据。

## 布局与交互

- 三列工作台：连接/仓库导航、文件列表、详情。窄窗口隐藏详情列。表格和文件内容保持不模糊。
- 连接区支持新建、编辑、删除；仓库区支持即时本地筛选。仓库列表显示类型，工作区标题显示仓库包类型。
- 目录用面包屑导航，双击目录进入，单击选中并请求详情。刷新只重新请求当前目录。加载、空目录、认证/权限/网络错误分别给出状态及重试入口。
- 上传支持一次选择多个本地文件，逐个报告完成或失败。下载使用系统保存对话框；同名本地文件需再次确认才覆盖。

## 性能和安全边界

- `GET /artifactory/api/repositories` 仅在打开连接时请求；目录使用 `GET /artifactory/api/storage/{repo}/{path}` 的直接子项，不执行全库递归扫描。路径切换时忽略过期响应。
- 上传以流式请求体发送，下载按网络分块写入同目录临时文件，成功后重命名；失败清理临时文件。HTTP 重定向关闭，避免 Bearer Token 跟随重定向。
- 所有网络请求和 Token 解析在 Rust 中执行。后端校验 URL 与仓库/文件路径，错误不回显 Token 或远端响应体。使用现有 `app_secrets` SQLite 机制；统一钥匙串迁移仍按 TODO 的 P1 项执行。
- HTTP URL 仅建议用于可信网络；TLS 证书仍由系统信任链校验。

## 后续演进

首版不做跨目录搜索、目录打包下载、属性编辑、批量删除、断点续传和传输队列。大文件需要真实 Artifactory 与 macOS/Windows 原生窗口验收；若需可恢复的超大文件传输，应另行设计多段上传及后台任务生命周期。

参考：[仓库列表 API](https://docs.jfrog.com/integrations/docs/use-api-endpoints-via-cli)、[存储项信息 API](https://docs.jfrog.com/artifactory/reference/getstorageitem)、[JFrog 的部署说明](https://docs.jfrog.com/artifactory/docs/deploying-artifacts)。
