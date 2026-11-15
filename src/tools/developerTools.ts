import { createTwoFilesPatch } from "diff";
import { CronExpressionParser } from "cron-parser";
import { readJsonValue } from "./jsonYaml.ts";

export function convertTimestamp(input: string): string {
  const value = input.trim();
  if (!/^[+-]?\d{1,16}$/.test(value) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("请输入 Unix 时间戳（最多 10 位按秒，其余按毫秒）或带时区的 ISO 8601 日期。");
  }
  if (value.includes("T")) {
    const day = value.slice(0, 10);
    const midnight = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(midnight.valueOf()) || !midnight.toISOString().startsWith(day) || value.slice(11, 13) === "24") {
      throw new Error("日期或时间无效。");
    }
  }
  const date = /^[+-]?\d+$/.test(value)
    ? new Date(Number(value) * (value.replace(/^[+-]/, "").length <= 10 ? 1000 : 1))
    : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error("日期或时间戳超出支持的范围。");
  return [
    `UTC       ${date.toISOString()}`,
    `本地时间  ${date.toLocaleString(undefined, { timeZoneName: "short", hour12: false })}`,
    `Unix 秒   ${date.valueOf() / 1000}`,
    `Unix 毫秒 ${date.valueOf()}`,
  ].join("\n");
}

export function compareText(before: string, after: string): string {
  if (before === after) return "内容相同。";
  const patch = createTwoFilesPatch("原始", "比较", before, after, "", "", { timeout: 350 });
  if (patch === undefined) throw new Error("差异过多，请分段比较。");
  return patch;
}

function canonicalJson(value: ReturnType<typeof readJsonValue>): ReturnType<typeof readJsonValue> {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

export function compareJson(before: string, after: string): string {
  return compareText(
    JSON.stringify(canonicalJson(readJsonValue(before)), null, 2),
    JSON.stringify(canonicalJson(readJsonValue(after)), null, 2),
  );
}

export function generateUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function convertChmod(input: string): string {
  const value = input.trim().replace(/^0o/i, "");
  if (/^[0-7]{3}$/.test(value)) {
    const symbolic = [...value].map((digit) =>
      Array.from("rwx", (permission, index) => Number(digit) & (4 >> index) ? permission : "-").join(""),
    ).join("");
    return `${value}\n${symbolic}`;
  }
  if (!/^(?:[r-][w-][x-]){3}$/.test(value)) {
    throw new Error("请输入三位八进制权限或九位 rwx 权限，例如 755、rwxr-xr-x。");
  }
  const octal = [0, 3, 6].map((start) =>
    Array.from(value.slice(start, start + 3)).reduce((bits, permission, index) => bits + (permission === "-" ? 0 : 4 >> index), 0),
  ).join("");
  return `${octal}\n${value}`;
}

export function parseCron(input: string, timezone: string, now = new Date()): string {
  const fields = input.trim().toUpperCase().split(/\s+/);
  const allowedField = /^(?:\*|\d+|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT)(?:(?:[-/,])(?:\d+|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT))*$/;
  if (fields.length !== 5 || fields.some((field) => !allowedField.test(field))) {
    throw new Error("请输入标准五字段 Cron 表达式。");
  }
  try {
    const schedule = CronExpressionParser.parse(`0 ${fields.join(" ")}`, { currentDate: now, tz: timezone });
    const dates = schedule.take(5);
    if (!dates.length) throw new Error("没有触发时间");
    const formatter = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
    });
    return [
      `分 / 时 / 日 / 月 / 周：${fields.join(" / ")}`,
      `时区：${timezone}`,
      ...dates.map((date) => formatter.format(date.toDate())),
    ].join("\n");
  } catch {
    throw new Error("Cron 表达式无效，或找不到下一次触发时间。");
  }
}
