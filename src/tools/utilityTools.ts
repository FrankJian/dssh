import Decimal from "decimal.js";
import jsep from "jsep";
import { decodeHTML, encodeHTML } from "entities";

const UPPER_BOUND = 1e6;
const D = Decimal.clone({ precision: 50, maxE: UPPER_BOUND, minE: -UPPER_BOUND });

function decimal(input: string): Decimal {
  const text = input.trim();
  if (text.length > 256 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,6})?$/i.test(text)) {
    throw new Error("请输入有效的十进制数字。");
  }
  const value = new D(text);
  if (!value.isFinite()) throw new Error("数字超出支持的范围。");
  return value;
}

function printDecimal(value: Decimal): string {
  if (!value.isFinite()) throw new Error("表达式结果超出支持的范围，或包含除以零。");
  return value.toString();
}

function arithmetic(node: jsep.Expression, depth = 0): Decimal {
  if (depth > 64) throw new Error("表达式嵌套过深。");
  if (node.type === "Literal") {
    const literal = node as jsep.Literal;
    if (typeof literal.value === "number") return decimal(literal.raw);
  }
  if (node.type === "UnaryExpression") {
    const { argument, operator } = node as jsep.UnaryExpression;
    if (operator === "+" || operator === "-") {
      const value = arithmetic(argument, depth + 1);
      return operator === "-" ? value.negated() : value;
    }
  }
  if (node.type === "BinaryExpression") {
    const { left, right, operator } = node as jsep.BinaryExpression;
    const a = arithmetic(left, depth + 1);
    const b = arithmetic(right, depth + 1);
    if (operator === "+") return a.plus(b);
    if (operator === "-") return a.minus(b);
    if (operator === "*") return a.times(b);
    if (operator === "/") return a.dividedBy(b);
    if (operator === "%") return a.modulo(b);
    if (operator === "**" && b.abs().lte(10_000)) return a.pow(b);
  }
  throw new Error("只支持数字、括号和 + - * / % **，指数绝对值最多 10,000。");
}

export function calculateExpression(input: string): string {
  if (input.length > 512 || !/^[\d.eE+*/%()\s-]+$/.test(input.trim())) throw new Error("请输入不超过 512 个字符的算术表达式。");
  return printDecimal(arithmetic(jsep(input)));
}

export function calculatePercentage(input: string, other: string, operation: string): string {
  const a = decimal(input);
  const b = decimal(other);
  if (operation === "of") return printDecimal(a.div(100).times(b));
  const ratio = operation === "change" ? b.minus(a).div(a.abs()) : a.div(b);
  return printDecimal(ratio.times(100)) + "%";
}

export function convertTemperature(input: string, unit: string): string {
  const value = decimal(input);
  const celsius = unit === "fahrenheit" ? value.minus(32).times(5).div(9)
    : unit === "kelvin" ? value.minus("273.15") : value;
  if (celsius.lt("-273.15")) throw new Error("温度低于绝对零度。");
  return [
    `°C  ${printDecimal(celsius.toSignificantDigits(16))}`,
    `°F  ${printDecimal(celsius.times(9).div(5).plus(32).toSignificantDigits(16))}`,
    `K   ${printDecimal(celsius.plus("273.15").toSignificantDigits(16))}`,
  ].join("\n");
}

export function calculateEta(progressInput: string, elapsedInput: string): string {
  const progress = decimal(progressInput);
  const elapsed = decimal(elapsedInput);
  if (progress.lte(0) || progress.gt(100) || elapsed.lt(0)) throw new Error("完成比例须大于 0 且不超过 100，已耗时须为非负数。");
  return `预计剩余 ${printDecimal(elapsed.times(new D(100).minus(progress)).div(progress).toDecimalPlaces(2))} 秒`;
}

const ROMAN = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"],
  [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
] as const;

function encodeRoman(value: number): string {
  if (value < 1 || value > 3999) throw new Error("罗马数字的转换范围为 1–3999。");
  return ROMAN.map(([number, symbol]) => {
    const count = Math.floor(value / number);
    value %= number;
    return symbol.repeat(count);
  }).join("");
}

export function convertRoman(input: string): string {
  const value = input.trim().toUpperCase();
  if (/^\d{1,4}$/.test(value)) return encodeRoman(Number(value));
  if (!/^[IVXLCDM]{1,15}$/.test(value)) throw new Error("请输入 1–3999 的整数或标准罗马数字。");
  let offset = 0;
  let total = 0;
  for (const [number, symbol] of ROMAN) {
    while (value.startsWith(symbol, offset)) { total += number; offset += symbol.length; }
  }
  if (offset !== value.length || encodeRoman(total) !== value) throw new Error("罗马数字写法无效。");
  return String(total);
}

export function htmlEntities(input: string, decode: boolean): string {
  return decode ? decodeHTML(input) : encodeHTML(input);
}

const NATO = "Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu".split(" ");
export function textToNato(input: string): string {
  return input.trim().split(/\s+/).filter(Boolean).map((word) =>
    [...word].map((character) => /^[a-z]$/i.test(character) ? NATO[character.toUpperCase().charCodeAt(0) - 65] : character).join(" "),
  ).join(" / ");
}

export function toNumeronym(input: string): string {
  return input.replace(/\p{L}{4,}/gu, (word) => {
    const characters = Array.from(word);
    return characters[0] + String(characters.length - 2) + characters[characters.length - 1];
  });
}

export function slugifyText(input: string): string {
  return input.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

export function generateLorem(input: string): string {
  const count = Number(input.trim());
  if (!/^\d{1,2}$/.test(input.trim()) || count < 1 || count > 20) throw new Error("请输入 1 到 20 个段落。");
  const paragraphs = [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae risus id magna tristique finibus. Sed posuere ante vitae nulla faucibus, a facilisis lectus tempus.",
    "Donec sit amet risus eu lectus commodo ultrices. Proin euismod, augue in commodo luctus, mi massa fermentum lectus, id tincidunt justo nunc et nibh.",
    "Mauris accumsan odio eget turpis facilisis, non suscipit lacus varius. Nam vitae velit et sem feugiat suscipit. Quisque placerat diam et leo tempor, sed fringilla nibh pretium.",
  ];
  return Array.from({ length: count }, (_, index) => paragraphs[index % paragraphs.length]).join("\n\n");
}

export function normalizeEmail(input: string, gmail: boolean): string {
  const address = input.trim();
  const parts = /^([^\s@"<>]+)@([^\s@/:?#\\]+)$/u.exec(address);
  if (!parts || parts[1].startsWith(".") || parts[1].endsWith(".") || parts[1].includes("..")) {
    throw new Error("请输入常见的 name@example.com 格式邮箱。");
  }
  const domain = new URL(`https://${parts[2]}`).hostname.toLowerCase();
  if (!domain.includes(".") || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("邮箱域名格式无效。");
  }
  const local = parts[1];
  if (!gmail) return `${local}@${domain}`;
  if (domain !== "gmail.com" && domain !== "googlemail.com") throw new Error("仅可对个人 Gmail 地址应用点号和标签规则。");
  const name = local.split("+", 1)[0].toLowerCase().replace(/\./g, "");
  if (!/^[a-z0-9]+$/.test(name)) throw new Error("Gmail 用户名格式无效。");
  return `${name}@gmail.com`;
}

export function decodeSafeLink(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("请输入完整的 Microsoft Safe Links URL。"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      !/(^|\.)safelinks\.protection\.outlook\.com$/i.test(url.hostname)) throw new Error("此地址并非 Microsoft Safe Links。");
  const destinations = url.searchParams.getAll("url");
  if (destinations.length !== 1) throw new Error("安全链接必须包含一个目标 URL。");
  let target: URL;
  try { target = new URL(destinations[0]); } catch { throw new Error("安全链接中的目标 URL 无效。"); }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("目标 URL 必须使用 HTTP 或 HTTPS。");
  return destinations[0];
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function generateUlid(time = Date.now()): string {
  if (!Number.isInteger(time) || time < 0 || time > 0xffffffffffff) throw new Error("ULID 时间超出范围。");
  let value = BigInt(time);
  for (const byte of crypto.getRandomValues(new Uint8Array(10))) value = (value << 8n) | BigInt(byte);
  let result = "";
  for (let index = 0; index < 26; index++) { result = CROCKFORD[Number(value & 31n)] + result; value >>= 5n; }
  return result;
}

function hexBytes(bytes: Uint8Array): string[] {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
}

export function randomMacAddress(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  bytes[0] = (bytes[0] & 0xfc) | 2;
  return hexBytes(bytes).join(":");
}

export function generateIpv6Ula(): string {
  const [a, b, c, d, e] = hexBytes(crypto.getRandomValues(new Uint8Array(5)));
  return `fd${a}:${b}${c}:${d}${e}::/48`;
}

export function buildCron(time: string, days: string, mode: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error("请输入有效时间 HH:MM。");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (mode === "hourly") return `${minute} * * * *`;
  if (mode === "daily") return `${minute} ${hour} * * *`;
  const week = days.trim().split(/[,\s]+/);
  if (week.some((day) => !/^[0-6]$/.test(day))) throw new Error("星期使用 0–6，0 代表星期日，可用逗号分隔。");
  return `${minute} ${hour} * * ${[...new Set(week)].sort().join(",")}`;
}
