function ipv4String(number: number): string {
  return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join(".");
}

function ipv4Number(input: string): number {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(input)) throw new Error("请输入有效的 IPv4 地址。");
  const octets = input.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) throw new Error("IPv4 地址无效。");
  return octets.reduce((total, octet) => total * 256 + octet, 0);
}

export function ipv4Subnet(input: string): string {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(input.trim());
  if (!match) throw new Error("请输入 IPv4 CIDR，例如 192.168.1.10/24。");
  const prefix = Number(match[2]);
  if (prefix > 32) throw new Error("IPv4 前缀无效。");
  const address = ipv4Number(match[1]);
  const count = 2 ** (32 - prefix);
  const first = Math.floor(address / count) * count;
  const last = first + count - 1;
  const hostFirst = count > 2 ? first + 1 : first;
  const hostLast = count > 2 ? last - 1 : last;
  return [
    `网络地址  ${ipv4String(first)}/${prefix}`,
    `子网掩码  ${ipv4String(2 ** 32 - count)}`,
    `广播地址  ${prefix >= 31 ? "无" : ipv4String(last)}`,
    `主机范围  ${ipv4String(hostFirst)} – ${ipv4String(hostLast)}`,
    `地址总数  ${count}`,
  ].join("\n");
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

export function radixInteger(input: string, base: number): bigint {
  const value = input.trim().toLowerCase();
  if (!Number.isInteger(base) || base < 2 || base > 36 || !/^[+-]?[a-z0-9]{1,256}$/.test(value)) {
    throw new Error("请输入最多 256 位的整数，进制范围为 2 到 36。");
  }
  let number = 0n;
  const radix = BigInt(base);
  for (const character of value.replace(/^[+-]/, "")) {
    const digit = DIGITS.indexOf(character);
    if (digit >= base) throw new Error(`输入包含 ${base} 进制不支持的数字。`);
    number = number * radix + BigInt(digit);
  }
  return value.startsWith("-") ? -number : number;
}

export function convertIpv4(input: string): string {
  const value = input.trim();
  let number: number;
  if (value.includes(".")) {
    number = ipv4Number(value);
  } else {
    const base = /^0x/i.test(value) ? 16 : /^0b/i.test(value) ? 2 : 10;
    const digits = base === 10 ? value : value.slice(2);
    if (!/^[a-z0-9]+$/i.test(digits)) throw new Error("IPv4 地址整数格式无效。");
    const integer = radixInteger(digits, base);
    if (integer < 0n || integer > 0xffffffffn) throw new Error("IPv4 地址整数应介于 0 和 4294967295。");
    number = Number(integer);
  }
  return [
    `点分十进制　${ipv4String(number)}`,
    `十进制整数　${number}`,
    `十六进制　0x${number.toString(16).padStart(8, "0")}`,
    `二进制　0b${number.toString(2).padStart(32, "0")}`,
  ].join("\n");
}

export function expandIpv4Range(start: string, end: string): string {
  const first = ipv4Number(start.trim());
  const last = ipv4Number(end.trim());
  const count = last - first + 1;
  if (count < 1) throw new Error("结束地址必须大于或等于起始地址。");
  if (count > 4096) throw new Error("一次最多展开 4096 个 IPv4 地址。");
  return Array.from({ length: count }, (_, offset) => ipv4String(first + offset)).join("\n");
}

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function randomToolToken(input: string): string {
  const length = Number(input.trim());
  if (!/^\d{1,3}$/.test(input.trim()) || length < 16 || length > 128) {
    throw new Error("令牌长度须为 16 到 128 个字符。");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => TOKEN_ALPHABET[byte & 63]).join("");
}

export function randomPort(): string {
  const [bits] = crypto.getRandomValues(new Uint16Array(1));
  return String(49152 + (bits & 0x3fff));
}
