import { useState, type ComponentProps } from "react";
import type { AdditionalToolId } from "./additionalCatalog";
import { TextTool } from "./ToolForm";
import { ToolNote, ToolSelect } from "./ToolControls";
import { runLocalTool } from "./localToolWorker";
import ConfigWorker from "./configTools.worker?worker";
import CryptoWorker from "./cryptoTools.worker?worker";
import RsaWorker from "./rsaKeys.worker?worker";
import PasswordWorker from "./passwordStrength.worker?worker";
import { maskText, openGraphTags, searchMemo } from "./advancedReferenceTools";
import { convertColor, svgPlaceholder } from "./colorTools";
import type { Digest } from "./cryptoTools";
import {
  buildCron, calculateEta, calculateExpression, calculatePercentage, convertRoman, convertTemperature,
  decodeSafeLink, generateIpv6Ula, generateLorem, generateUlid, htmlEntities, normalizeEmail,
  randomMacAddress, slugifyText, textToNato, toNumeronym,
} from "./utilityTools";

type Choice = readonly [value: string, label: string];
type PageRun = (input: string, other: string, choice: string) => string | Promise<string>;
interface PageSpec extends Omit<ComponentProps<typeof TextTool>, "action" | "options" | "run"> {
  action?: string;
  note?: string;
  choice?: { label: string; values: readonly Choice[]; initial?: string };
  run: PageRun;
}

const config = (id: string): PageRun => (input, other, option) =>
  runLocalTool(() => new ConfigWorker(), { id, input, other, option });
const cryptoJob = (id: string): PageRun => (input, other, option) =>
  runLocalTool(() => new CryptoWorker(), { id, input, other, option });

const TOML = "[server]\nhost = \"localhost\"\nport = 22";
const JSON_CONFIG = '{"server":{"host":"localhost","port":22}}';
const YAML = "server:\n  host: localhost\n  port: 22";
const XML = '<hosts><host port="22"><name>dev</name></host></hosts>';
const DIGEST_OPTIONS: readonly Choice[] = [
  ["sha256", "SHA-256"], ["sha384", "SHA-384"], ["sha512", "SHA-512"],
  ["sha224", "SHA-224"], ["sha1", "SHA-1"], ["md5", "MD5"],
];
const cryptoTools = () => import("./cryptoTools");
const referenceTools = () => import("./referenceTools");

const pages: Record<AdditionalToolId, PageSpec> = {
  "yaml-format": {
    action: "格式化", inputLabel: "YAML 输入", outputLabel: "YAML 结果",
    example: "# SSH 配置\nserver: {host: localhost, port: 22}", run: config("yaml-format"),
  },
  "toml-json": {
    inputLabel: "TOML 输入", outputLabel: "JSON 结果", example: TOML,
    note: "日期和时间转换为字符串，保留原有偏移和小数秒。", run: config("toml-json"),
  },
  "toml-yaml": {
    inputLabel: "TOML 输入", outputLabel: "YAML 结果", example: TOML,
    note: "日期和时间转换为字符串，保留原有偏移和小数秒。", run: config("toml-yaml"),
  },
  "json-toml": { inputLabel: "JSON 输入", outputLabel: "TOML 结果", example: JSON_CONFIG, run: config("json-toml") },
  "yaml-toml": {
    inputLabel: "YAML 输入", outputLabel: "TOML 结果", example: YAML,
    note: "注释不会出现在结果中。", run: config("yaml-toml"),
  },
  "xml-format": {
    action: "格式化", inputLabel: "XML 输入", outputLabel: "XML 结果", example: XML,
    note: "保留混合内容、CDATA 和 xml:space 指定的空白。", run: config("xml-format"),
  },
  "xml-json": { inputLabel: "XML 输入", outputLabel: "JSON 结果", example: XML, run: config("xml-json") },
  "json-xml": {
    inputLabel: "JSON 对象", outputLabel: "XML 结果",
    example: '{"hosts":{"host":[{"_attributes":{"port":22},"_text":"dev"},{"_attributes":{"port":2200},"_text":"qa"}]}}',
    note: "支持单根对象和 XML 转 JSON 生成的有序节点结构。普通对象可用 _attributes、_text、_cdata 表示 XML 内容。", run: config("json-xml"),
  },
  "sql-format": {
    action: "格式化", inputLabel: "SQL 输入", outputLabel: "SQL 结果",
    example: "select name,port from hosts where port>=22 order by name;",
    choice: { label: "方言", values: [["sql", "标准 SQL"], ["mysql", "MySQL"], ["postgresql", "PostgreSQL"], ["sqlite", "SQLite"], ["tsql", "SQL Server"]] },
    run: config("sql-format"),
  },
  "markdown-html": {
    inputLabel: "Markdown 输入", outputLabel: "HTML 源码", example: "# 主机清单\n\n- **dev**\n- [文档](https://example.org/)",
    run: async (input) => (await import("./markdownToHtml")).markdownToHtml(input),
  },
  "docker-compose": {
    inputLabel: "Docker 命令", outputLabel: "Compose YAML",
    example: 'docker run -d --name web --restart unless-stopped -p 8080:80 -e "MODE=demo" nginx:alpine',
    note: "支持常见参数。原命令使用 -d 时，以 docker compose up -d 启动服务。", run: config("docker-compose"),
  },
  "cron-build": {
    action: "生成", inputLabel: "时间（HH:MM）", inputType: "text", outputLabel: "五字段 Cron 表达式", example: "09:30",
    secondInput: { label: "星期（仅每周模式，0 为星期日）", example: "1,3,5", type: "text" },
    choice: { label: "频率", values: [["daily", "每日"], ["weekly", "每周"], ["hourly", "每小时（只取分钟）"]] },
    run: buildCron,
  },
  "ipv6-ula": { action: "生成", outputLabel: "IPv6 ULA /48 前缀", run: generateIpv6Ula },
  "mac-generate": { action: "生成", outputLabel: "本地管理的单播 MAC 地址", run: randomMacAddress },
  ulid: { action: "生成", outputLabel: "ULID", run: () => generateUlid() },
  digest: {
    action: "计算摘要", inputLabel: "文本输入", outputLabel: "十六进制摘要", example: "Duo SSH",
    choice: { label: "算法", values: DIGEST_OPTIONS },
    note: "MD5 和 SHA-1 适用于兼容性校验。", run: async (input, _, option) => (await cryptoTools()).digestText(input, option as Digest),
  },
  hmac: {
    action: "生成", inputLabel: "消息", outputLabel: "十六进制 HMAC", example: "Duo SSH",
    secondInput: { label: "UTF-8 密钥", example: "demo-key", type: "password" },
    choice: { label: "算法", values: DIGEST_OPTIONS.slice(0, 4) },
    run: async (input, other, option) => (await cryptoTools()).hmacText(input, other, option as Digest),
  },
  totp: {
    action: "生成验证码", inputLabel: "Base32 密钥", inputType: "password", outputLabel: "验证码", example: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    secondInput: { label: "Unix 秒数（留空使用当前时间）", example: "59", type: "text" },
    choice: { label: "算法与位数", values: [
      ["sha1:6", "SHA-1 · 6 位"], ["sha1:8", "SHA-1 · 8 位"],
      ["sha256:6", "SHA-256 · 6 位"], ["sha256:8", "SHA-256 · 8 位"],
      ["sha512:6", "SHA-512 · 6 位"], ["sha512:8", "SHA-512 · 8 位"],
    ] },
    note: "验证码每 30 秒变化。点击「生成验证码」可刷新。",
    run: async (input, time, option) => {
      const [algorithm, digits] = option.split(":") as ["sha1" | "sha256" | "sha512", "6" | "8"];
      if (time.trim() && !/^\d+$/.test(time.trim())) throw new Error("请输入有效的 Unix 秒数。");
      const seconds = time.trim() ? Number(time.trim()) : Math.floor(Date.now() / 1000);
      return (await cryptoTools()).makeTotp(input, seconds, digits === "8" ? 8 : 6, algorithm);
    },
  },
  bcrypt: {
    action: "运行", inputLabel: "密码", inputType: "password", outputLabel: "哈希或验证结果", example: "demo-password",
    secondInput: { label: "待验证的 bcrypt 哈希（验证模式）", example: "", type: "text" },
    choice: { label: "操作", values: [["10", "生成 · 成本 10"], ["11", "生成 · 成本 11"], ["12", "生成 · 成本 12"], ["verify", "验证哈希"]] },
    run: cryptoJob("bcrypt"),
  },
  bip39: {
    action: "生成助记词", outputLabel: "英文 BIP39 助记词",
    choice: { label: "单词数", values: ["12", "15", "18", "21", "24"].map((value) => [value, value]) },
    run: async (_, __, count) => (await cryptoTools()).generateBip39(Number(count)),
  },
  "aes-encryption": {
    action: "运行", inputLabel: "明文或密文", outputLabel: "处理结果", example: "Duo SSH",
    secondInput: { label: "口令", example: "demo-password", type: "password" },
    choice: { label: "操作", values: [["encrypt", "加密"], ["decrypt", "解密"]] },
    note: "解密需要原口令和完整的密文字符串。", run: cryptoJob("aes-encryption"),
  },
  "html-entities": {
    inputLabel: "文本或 HTML 实体", outputLabel: "转换结果", example: "<p>中文 & text</p>",
    choice: { label: "操作", values: [["encode", "编码"], ["decode", "解码"]] },
    run: (input, _, mode) => htmlEntities(input, mode === "decode"),
  },
  "http-status": {
    action: "查询", inputLabel: "状态码或英文关键词", inputType: "text", outputLabel: "匹配的 HTTP 状态码", example: "404",
    run: async (input) => (await referenceTools()).lookupHttpStatus(input),
  },
  "mime-lookup": {
    action: "查询", inputLabel: "文件后缀、文件名或 MIME 类型", inputType: "text", outputLabel: "查询结果", example: ".json",
    run: async (input) => (await referenceTools()).lookupMime(input),
  },
  "ua-parser": {
    action: "解析", inputLabel: "User-Agent 字符串", outputLabel: "解析结果",
    example: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    run: async (input) => (await referenceTools()).inspectUserAgent(input),
  },
  safelinks: {
    action: "解码", inputLabel: "Microsoft Safe Links URL", outputLabel: "原始 URL",
    example: "https://nam01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org%2Fdocs%3Fa%3D1",
    run: decodeSafeLink,
  },
  "email-normalize": {
    inputLabel: "邮箱地址", inputType: "text", outputLabel: "规范化地址", example: "Demo.Name+ssh@GMAIL.COM",
    choice: { label: "规则", values: [["domain", "规范化域名"], ["gmail", "个人 Gmail"]] },
    run: (input, _, mode) => normalizeEmail(input, mode === "gmail"),
  },
  slugify: { inputLabel: "文本", outputLabel: "Slug", example: "Duo SSH 工具箱 Café", run: slugifyText },
  numeronym: { inputLabel: "原文", outputLabel: "数字缩写", example: "internationalization and localization", run: toNumeronym },
  nato: { inputLabel: "字母或文本", outputLabel: "NATO 拼读", example: "Duo SSH", run: textToNato },
  lorem: { action: "生成", inputLabel: "段落数（1–20）", inputType: "text", outputLabel: "占位文本", example: "3", run: generateLorem },
  "svg-placeholder": {
    action: "生成", inputLabel: "尺寸（宽 × 高）", inputType: "text", outputLabel: "SVG 源码", example: "640x360",
    secondInput: { label: "文字（可选）", example: "Duo SSH", type: "text" }, run: svgPlaceholder,
  },
  colors: { inputLabel: "HEX、RGB 或 HSL", inputType: "text", outputLabel: "颜色表示", example: "#35866fa0", run: convertColor },
  math: {
    action: "计算", inputLabel: "算术表达式", inputType: "text", outputLabel: "计算结果", example: "(0.1 + 0.2) * 10",
    note: "支持 +、-、*、/、%（取余）、**（乘方）和括号。", run: calculateExpression,
  },
  percentage: {
    action: "计算", inputLabel: "数值 A", inputType: "text", outputLabel: "计算结果", example: "25",
    secondInput: { label: "数值 B", example: "80", type: "text" },
    choice: { label: "公式", values: [["of", "B 的 A%"], ["ratio", "A 占 B 的百分比"], ["change", "从 A 到 B 的变化率"]] },
    note: "变化率以数值 A 的绝对值为基数。", run: calculatePercentage,
  },
  temperature: {
    inputLabel: "温度", inputType: "text", outputLabel: "温度换算", example: "32",
    choice: { label: "输入单位", values: [["fahrenheit", "华氏 °F"], ["celsius", "摄氏 °C"], ["kelvin", "开尔文 K"]] },
    run: (input, _, unit) => convertTemperature(input, unit),
  },
  eta: {
    action: "估算", inputLabel: "已完成百分比（0–100）", inputType: "text", outputLabel: "剩余时间", example: "25",
    secondInput: { label: "已耗时（秒）", example: "60", type: "text" }, run: calculateEta,
  },
  roman: { inputLabel: "十进制整数或罗马数字", inputType: "text", outputLabel: "转换结果", example: "MCMXCIV", run: convertRoman },
  phone: {
    action: "格式化", inputLabel: "带国际区号的电话号码", inputType: "text", outputLabel: "电话号码格式", example: "+1 202 555 0123",
    run: async (input) => (await referenceTools()).formatPhone(input),
  },
  iban: {
    action: "检查格式", inputLabel: "IBAN", inputType: "text", outputLabel: "结构与校验和", example: "GB82 WEST 1234 5698 7654 32",
    run: async (input) => (await referenceTools()).inspectIban(input),
  },
  "password-strength": {
    action: "估算", inputLabel: "密码", inputType: "password", outputLabel: "强度估算", example: "demo-password",
    run: (input) => runLocalTool(() => new PasswordWorker(), { id: "password-strength", input, other: "", option: "" }),
  },
  "rsa-key": {
    action: "生成 2048 位密钥对", outputLabel: "RSA PEM 密钥对", multilineOutput: true,
    note: "输出依次包含公钥和未加密的 PKCS#8 私钥。请妥善保存私钥。",
    run: () => runLocalTool(() => new RsaWorker(), { id: "rsa-key", input: "", other: "", option: "" }),
  },
  "device-info": {
    action: "读取环境", outputLabel: "运行环境", multilineOutput: true,
    run: () => JSON.stringify({
      userAgent: navigator.userAgent, languages: navigator.languages, logicalCpuThreads: navigator.hardwareConcurrency,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      pixelRatio: window.devicePixelRatio,
      screenWidth: window.screen.width, screenHeight: window.screen.height,
    }, null, 2),
  },
  "og-meta": {
    action: "生成", inputLabel: "页面标题", inputType: "text", outputLabel: "HTML 标签", example: "Duo SSH",
    secondInput: { label: "描述（可选）", example: "跨平台 SSH 管理器" }, run: openGraphTags,
  },
  "ascii-art": {
    action: "生成", inputLabel: "ASCII 文本", outputLabel: "字符画", example: "Duo SSH",
    choice: { label: "字体", values: [["Standard", "标准"], ["Small", "小型"]] },
    run: async (input, _, font) => (await import("./asciiArt")).asciiArt(input, font as "Standard" | "Small"),
  },
  "text-mask": {
    action: "脱敏", inputLabel: "原文本", outputLabel: "脱敏结果", example: "234567890123",
    choice: { label: "模式", values: [["edges", "保留首尾各两字"], ["all", "全部遮盖"]] },
    run: (input, _, mode) => maskText(input, mode),
  },
  "git-memo": {
    action: "查询", inputLabel: "关键词（留空显示全部）", inputType: "text", outputLabel: "Git 命令", example: "stash",
    run: (input) => searchMemo(input, "git"),
  },
  "regex-memo": {
    action: "查询", inputLabel: "关键词（留空显示全部）", inputType: "text", outputLabel: "JavaScript 正则语法", example: "捕获",
    run: (input) => searchMemo(input, "regex"),
  },
};

export default function AdditionalToolPage({ id }: { id: AdditionalToolId }) {
  const { note, choice, run, action = "转换", ...form } = pages[id];
  const [value, setValue] = useState(choice?.initial ?? choice?.values[0]?.[0] ?? "");
  return (
    <>
      {note ? <ToolNote>{note}</ToolNote> : null}
      <TextTool
        {...form}
        action={action}
        resultKey={value}
        options={choice ? (
          <ToolSelect label={choice.label} value={value} onChange={setValue}
            options={choice.values.map(([key, label]) => ({ value: key, label }))} />
        ) : undefined}
        run={(input, other) => run(input, other, value)}
      />
    </>
  );
}
