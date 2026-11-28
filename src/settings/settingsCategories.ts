export type SettingsCategory = "appearance" | "terminal" | "editor" | "shortcuts" | "security" | "s3" | "ai" | "config" | "about";

export const SETTINGS_CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  icon: "sun" | "monitor" | "fileCode" | "command" | "shield" | "bucket" | "file" | "bot" | "info";
  keywords: string;
}> = [
  { icon: "sun", id: "appearance", label: "外观", keywords: "appearance theme 主题 深色 浅色 跟随系统 左侧导航栏 导航图标 浏览器 browser 会话首页 最近连接 显示数量" },
  { icon: "monitor", id: "terminal", label: "终端", keywords: "terminal browser 浏览器 URL 链接 Chrome Edge 命令补全 历史命令 清空历史 存储上限 字体 字号 行高 字间距 鼠标 右键 选中复制 GPU 渲染 背景图 磨砂 透明度 边距 配色 后台 任务完成通知" },
  { icon: "fileCode", id: "editor", label: "文件编辑器", keywords: "editor monaco 字体 字号 显示 编辑 自动换行 行号 小地图 Tab宽度 空白字符 缩进" },
  { icon: "command", id: "shortcuts", label: "快捷键", keywords: "shortcut keybinding hotkey 按键 组合键 自定义 重置" },
  { icon: "shield", id: "security", label: "安全与锁屏", keywords: "security lock 锁定 密码 自动锁屏 超时" },
  { icon: "bucket", id: "s3", label: "对象存储", keywords: "s3 object storage 上传 下载 传输并发" },
  { icon: "bot", id: "ai", label: "AI", keywords: "ai api 模型 助手 停靠 位置 左侧 右侧 底部 布局" },
  { icon: "file", id: "config", label: "配置文件", keywords: "config profile import export 导入 加密导出 备份" },
  { icon: "info", id: "about", label: "关于", keywords: "about version 版本 更新" },
];
