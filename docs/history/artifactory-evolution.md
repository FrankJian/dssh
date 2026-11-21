# Artifactory 构件工作台

> 迁入的说明与实现记录；行为要求以关联 OpenSpec 主规格为准。
> 来源：`features/artifactory-workspace.md`，整理于 2026-11-21。保留原文时间与验收限定语。


## 后续演进与取舍

建议按以下顺序演进：

1. **跨目录搜索**：用 AQL 按仓库、名称、属性筛选，结果分页和限制返回字段；避免全库递归加载。AQL 的查询大小与权限受服务端限制，初版应限制为已选仓库。
2. **复制/移动构件**：先支持服务端 dry run，再明确目标路径、覆盖结果和权限。复制 API 需要 Artifactory Pro；移动和删除属于远端变更，交互需确认。
3. **传输恢复**：为超大文件设计可持久化的任务及分段/断点协议，确认服务端支持和跨平台恢复语义后再接入。

[原验证记录](../verification/artifactory.md#artifactory-limits)

参考：[存储项信息 API](https://docs.jfrog.com/artifactory/reference/getstorageitem)、[目录归档 API](https://docs.jfrog.com/artifactory/reference/retrieveFolderOrRepositoryArchive)、[更新属性 API](https://docs.jfrog.com/artifactory/reference/updateitemproperties)、[AQL](https://docs.jfrog.com/artifactory/reference/searchaql)、[复制项 API](https://docs.jfrog.com/artifactory/reference/copyitem)。
