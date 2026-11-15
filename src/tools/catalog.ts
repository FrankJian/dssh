import { createElement, lazy } from "react";
import { ADDITIONAL_TOOLS } from "./additionalCatalog";

type DeveloperPages = typeof import("./DeveloperToolPages");

function developerPage(name: keyof DeveloperPages) {
  return lazy(async () => {
    const pages = await import("./DeveloperToolPages");
    return { default: pages[name] };
  });
}

type MorePages = typeof import("./MoreToolPages");

function morePage(name: keyof MorePages) {
  return lazy(async () => {
    const pages = await import("./MoreToolPages");
    return { default: pages[name] };
  });
}

const AdditionalToolPage = lazy(() => import("./AdditionalToolPage"));
const additionalEntries = ADDITIONAL_TOOLS.map((tool) => ({
  ...tool,
  component: function LocalToolPage() { return createElement(AdditionalToolPage, { id: tool.id }); },
}));

export const TOOL_CATALOG = [
  { id: "json-format", label: "JSON 格式化", category: "数据与配置", keywords: "json format minify 压缩 校验 美化", component: lazy(() => import("./JsonFormatTool")) },
  { id: "json-yaml", label: "JSON ↔ YAML", category: "数据与配置", keywords: "json yaml yml convert 转换 互转", component: lazy(() => import("./YamlTool")) },
  { id: "text-png", label: "文本转 PNG", category: "文本与图片", keywords: "text png image screenshot 文字 图片 截图 代码", component: lazy(() => import("./TextImageTool")) },
  { id: "code-png", label: "代码转图片", category: "文本与图片", keywords: "code screenshot snippet syntax highlight png export 代码 截图 导出 高亮 图片", component: lazy(() => import("./CodeImageTool")) },
  { id: "base64", label: "Base64 编解码", category: "编码与生成", keywords: "base64 encode decode 编码 解码", component: developerPage("Base64Tool") },
  { id: "url-codec", label: "URL 编解码", category: "编码与生成", keywords: "url uri percent encode decode 百分号 编码 解码", component: developerPage("UrlTool") },
  { id: "timestamp", label: "时间戳转换", category: "编码与生成", keywords: "unix timestamp epoch iso utc 日期 时间", component: developerPage("TimestampTool") },
  { id: "uuid", label: "UUID v4 生成", category: "编码与生成", keywords: "uuid guid random 随机 标识符", component: developerPage("UuidTool") },
  { id: "text-diff", label: "文本对比", category: "文本与图片", keywords: "text diff compare 比较 差异", component: developerPage("TextDiffTool") },
  { id: "json-diff", label: "JSON 对比", category: "数据与配置", keywords: "json diff compare 比较 差异", component: developerPage("JsonDiffTool") },
  { id: "sha256", label: "SHA-256 文本哈希", category: "编码与生成", keywords: "sha256 sha-256 hash digest 摘要 散列 校验", component: developerPage("HashTool") },
  { id: "ipv4", label: "IPv4 子网计算", category: "运维", keywords: "ipv4 cidr subnet mask network ip 网段 掩码 广播", component: developerPage("SubnetTool") },
  { id: "chmod", label: "chmod 权限换算", category: "运维", keywords: "chmod rwx permissions octal linux 八进制 权限", component: developerPage("ChmodTool") },
  { id: "cron", label: "Cron 表达式解析", category: "运维", keywords: "cron crontab schedule 定时 调度", component: developerPage("CronTool") },
  { id: "url-parser", label: "URL 解析", category: "Web 与认证", keywords: "url parse host query parameter 链接 参数 主机", component: morePage("UrlParserTool") },
  { id: "jwt", label: "JWT 解码", category: "Web 与认证", keywords: "jwt jws token base64url header payload 令牌 解析", component: morePage("JwtTool") },
  { id: "basic-auth", label: "Basic Auth 生成", category: "Web 与认证", keywords: "basic auth http authorization header 认证 请求头", component: morePage("BasicAuthTool") },
  { id: "json-csv", label: "JSON 转 CSV", category: "数据与配置", keywords: "json csv table convert 表格 转换", component: morePage("JsonCsvTool") },
  { id: "ipv4-convert", label: "IPv4 地址换算", category: "运维", keywords: "ipv4 address binary hexadecimal ip 十六进制 二进制", component: morePage("Ipv4ConvertTool") },
  { id: "ipv4-range", label: "IPv4 范围展开", category: "运维", keywords: "ipv4 range expand ip 地址列表 范围", component: morePage("Ipv4RangeTool") },
  { id: "integer-base", label: "整数进制转换", category: "编码与生成", keywords: "base radix binary decimal octal hex bigint 数字 进制", component: morePage("RadixTool") },
  { id: "unicode", label: "Unicode 码点转换", category: "编码与生成", keywords: "unicode code point 字符 编码", component: morePage("UnicodeTool") },
  { id: "binary", label: "文本与二进制互转", category: "编码与生成", keywords: "text binary utf8 utf-8 字节 编码", component: morePage("BinaryTool") },
  { id: "text-case", label: "大小写与命名转换", category: "文本与图片", keywords: "case upper lower camel pascal snake kebab 大小写 命名", component: morePage("TextCaseTool") },
  { id: "text-statistics", label: "文本统计", category: "文本与图片", keywords: "text statistics word count bytes 字数 行数 字节", component: morePage("TextStatisticsTool") },
  { id: "list-converter", label: "列表转换", category: "文本与图片", keywords: "list delimiter separator dedupe comma tab 分隔符 逗号 去重", component: morePage("ListConverterTool") },
  { id: "random-port", label: "随机端口号", category: "运维", keywords: "random port ephemeral 动态 端口 随机", component: morePage("RandomPortTool") },
  { id: "random-token", label: "随机令牌", category: "编码与生成", keywords: "random token base64url 随机 字符串 令牌", component: morePage("RandomTokenTool") },
  { id: "regex", label: "正则表达式测试", category: "文本与图片", keywords: "regex regexp regular expression pattern 正则 匹配", component: lazy(() => import("./RegexTool")) },
  ...additionalEntries,
  { id: "base64-file", label: "文件转 Base64", category: "编码与生成", keywords: "base64 file 文件 编码", component: lazy(() => import("./FileBase64Tool")) },
  { id: "qr-code", label: "二维码生成", category: "文本与图片", keywords: "qrcode qr code 二维码 扫码 PNG", component: lazy(() => import("./QrTool").then(({ QrTool }) => ({ default: QrTool }))) },
  { id: "wifi-qr", label: "Wi-Fi 二维码", category: "文本与图片", keywords: "wifi wlan qr code 二维码 无线 网络", component: lazy(() => import("./QrTool").then(({ WifiQrTool }) => ({ default: WifiQrTool }))) },
  { id: "emoji-picker", label: "Emoji 选择器", category: "文本与图片", keywords: "emoji picker unicode 表情 符号", component: lazy(() => import("./EmojiTool")) },
  { id: "keycode-info", label: "键盘按键信息", category: "参考与计算", keywords: "keycode keyboard event key code 按键 键盘", component: lazy(() => import("./KeyCodeTool")) },
  { id: "stopwatch", label: "秒表", category: "参考与计算", keywords: "chronometer stopwatch timer 计时 计次", component: lazy(() => import("./StopwatchTool")) },
] as const;

export type ToolId = typeof TOOL_CATALOG[number]["id"];
