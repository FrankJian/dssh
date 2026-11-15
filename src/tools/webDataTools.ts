import { decodeBase64, encodeBase64 } from "./base64.ts";
import { formatJson, readJsonValue } from "./jsonYaml.ts";

export function parseToolUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("请输入包含协议的完整 URL。");
  }

  return JSON.stringify({
    protocol: url.protocol.slice(0, -1),
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    query: [...url.searchParams],
    fragment: url.hash.slice(1),
    ...(url.username || url.password ? { username: url.username, hasPassword: Boolean(url.password) } : {}),
  }, null, 2);
}

function jwtJson(segment: string, label: string): string {
  try {
    const text = decodeBase64(segment.replace(/-/g, "+").replace(/_/g, "/"));
    const formatted = formatJson(text, 2);
    if (!formatted.startsWith("{")) throw new Error();
    return formatted;
  } catch {
    throw new Error(`JWT ${label}必须是 Base64URL 编码的 JSON 对象。`);
  }
}

export function inspectJwt(input: string): string {
  const parts = input.trim().split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part) || part.length % 4 === 1)
      || !parts[0] || !parts[1]) {
    throw new Error("请输入三段式 JWT。");
  }
  const header = jwtJson(parts[0], "头部");
  const payload = jwtJson(parts[1], "载荷");
  return `头部\n${header}\n\n载荷\n${payload}\n\n签名（Base64URL）\n${parts[2] || "空"}`;
}

export function basicAuth(username: string, password: string): string {
  if (!username) throw new Error("请输入用户名。");
  if (username.includes(":")) throw new Error("用户名不能含有冒号。");
  if ([...username, ...password].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("用户名和密码不能含有控制字符。");
  }
  return "Authorization: Basic " + encodeBase64(`${username}:${password}`);
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function jsonToCsv(input: string): string {
  const rows = readJsonValue(input);
  if (!Array.isArray(rows) || !rows.length || !rows.every(
    (row): row is Record<string, ReturnType<typeof readJsonValue>> =>
      row !== null && typeof row === "object" && !Array.isArray(row),
  )) {
    throw new Error("请输入至少包含一个对象的 JSON 数组。");
  }
  const fields = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) fields.add(key);
  }
  if (!fields.size) throw new Error("JSON 对象中至少需要一个列名。");
  if (fields.size * rows.length > 100_000) throw new Error("表格超过 100,000 个单元格，请分批转换。");

  const columns = [...fields];
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((key) => csvCell(Object.prototype.hasOwnProperty.call(row, key) ? row[key] : null)).join(","));
  }
  return lines.join("\r\n");
}
