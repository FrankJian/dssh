import { parsePhoneNumberWithError } from "libphonenumber-js/max";
import { extractIBAN, friendlyFormatIBAN } from "ibantools";
import Bowser from "bowser";
import database from "mime-db";
import httpStatuses from "./httpStatuses.json" with { type: "json" };

export function inspectUserAgent(input: string): string {
  if (!input.trim() || input.length > 4096) throw new Error("请输入不超过 4096 个字符的 User-Agent。");
  return JSON.stringify(Bowser.parse(input.trim()), null, 2);
}

export function formatPhone(input: string): string {
  if (!input.trim().startsWith("+") || input.length > 128) throw new Error("请输入带国际区号的号码，例如 +1 202 555 0123。");
  const phone = parsePhoneNumberWithError(input.trim(), { extract: false });
  if (!phone.isValid()) throw new Error("号码格式不符合该区号的编号规则。");
  return [`E.164  ${phone.number}`, `国际格式  ${phone.formatInternational()}`, `本地格式  ${phone.formatNational()}`,
    `国家或地区  ${phone.country ?? "非地理号码"}`].join("\n");
}

export function inspectIban(input: string): string {
  const shortened = input.trim().replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[0-9A-Z]{1,30}$/.test(shortened)) throw new Error("请输入有效的 IBAN 字符串。");
  const iban = extractIBAN(shortened);
  if (!iban.valid) throw new Error("IBAN 长度、结构或校验和无效。");
  return [`IBAN  ${friendlyFormatIBAN(shortened)}`, `国家或地区  ${iban.countryCode}`, `BBAN  ${iban.bban}`].join("\n");
}

export function lookupHttpStatus(input: string): string {
  const query = input.trim().toLowerCase();
  if (!query) throw new Error("请输入状态码或英文含义。");
  const entries = Object.entries(httpStatuses).filter(([code, label]) =>
    /^\d{3}$/.test(query) ? code === query : (query === "all" || `${code} ${label}`.toLowerCase().includes(query)),
  );
  if (!entries.length) throw new Error("IANA 当前离线表中没有匹配的状态码。");
  return entries.map(([code, label]) => `${code}  ${label}`).join("\n");
}

const mimeByExtension = new Map<string, string[]>();
for (const [mime, entry] of Object.entries(database)) {
  for (const extension of entry.extensions ?? []) {
    const values = mimeByExtension.get(extension) ?? [];
    values.push(mime);
    mimeByExtension.set(extension, values);
  }
}

export function lookupMime(input: string): string {
  const key = input.trim().toLowerCase();
  if (!key) throw new Error("请输入文件后缀或 MIME 类型。");
  if (key.includes("/")) {
    const mime = key.split(";", 1)[0].trim();
    if (!Object.prototype.hasOwnProperty.call(database, mime)) throw new Error("离线数据库中没有此 MIME 类型。");
    return [mime, ...(database[mime].extensions ?? []).map((extension) => `.${extension}`)].join("\n");
  }
  const extension = key.split(".").pop() ?? "";
  const types = mimeByExtension.get(extension);
  if (!types) throw new Error("离线数据库中没有此文件后缀。");
  return types.join("\n");
}

