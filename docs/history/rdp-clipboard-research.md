# RDP 剪贴板实施前调研

> 以下是升级前 3.32.2 的源码核查，不是当前 3.33.0 实施状态；保留原始措辞与来源。

## 2. 已确认的现状

- `src-tauri/src/rdp/protocol.rs` 固定发送 `-clipboard` 和 `-drives`，目前不能通过设置启用。
- 已有独立 worker、私有参数管道与按工作台归属的会话，不需要增加另一条网络连接或安装服务器代理。
- 固定引擎是 FreeRDP 3.32.2 的 SDL3 客户端；`sdl_clip.cpp` 已实现文本格式协商、剪贴板更新、数据请求和响应，可作为文本能力基础。
- 同版 `client/common/client_cliprdr_file.c` 的 `cliprdr_file_context_has_local_support` 只在 `WITH_FUSE` 时返回真；本地实际 CMake 缓存为 `WITH_FUSE=OFF`。不能把含有 FileContents 回调等同于已具备系统文件管理器双向粘贴能力。
- SDL3 的文件列表桥接主要使用 `text/uri-list` 等 MIME，Windows Explorer 的文件复制还涉及 `CF_HDROP`、OLE 数据对象及延迟取数；已有 `client/Windows/wf_cliprdr.c` 是原生 Windows 客户端实现，依赖其上下文，不能直接链接进 SDL3 就当作完成。
- 3.32.2 的命令行能解析 `direction-to` / `files-to`，但该版 `sdl_clip.cpp` 没有消费 `ClipboardFeatureMask`。所以仅加参数不能证明“仅文本”或方向限制实际生效，必须检查并约束原生格式发布和数据处理路径。

这些是对当前固定版本的源码审查结论；不代表已进行真实服务器的剪贴板传输验收。
