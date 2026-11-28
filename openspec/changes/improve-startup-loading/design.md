# Design

MainApp 的静态导入当前把未使用功能带入首屏。拆出轻量 settingsCategories；App 只保留导航/服务/状态，界面通过可恢复懒加载边界首次请求。所有懒加载定义位于模块级，已挂载编辑器和工具继续保持原有生命周期，不因切换卸载。

terminalRegistry 保留 instances、输出暂停回调、pendingSnapshots、主题订阅及原有同步接口。xterm 和插件构造器移入单独模块；LazyTerminalView 并行请求视图和构造器，全部就绪才渲染。共享资源加载器去重，失败清理 in-flight promise，显式重试重新发起；从不改变输出 ACK 或订阅的消费语义。

只减少首屏加载范围，不把锁屏初始化或主机身份验证挪到可绕过的位置。数据库与原生窗口启动链路审阅后保留；本机无法代表 Windows 的 WebView2/杀毒扫描/冷磁盘表现。

验证基于生产静态依赖图（含入口静态 imports 闭包，排除动态 imports），记录 UTF-8 和 gzip 字节；相关功能、终端首次打开与并发加载/失败重试回归。构建体积变化不是启动秒数；原生 Windows 冷启动、首个终端延迟随发布前实机检查。
