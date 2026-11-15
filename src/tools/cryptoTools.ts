import { gcm } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import bcrypt from "bcryptjs";
import { decodeBase64Bytes, encodeBase64Bytes } from "./base64.ts";

export const DIGESTS = { md5, sha1, sha224, sha256, sha384, sha512 };
export type Digest = keyof typeof DIGESTS;

export function digestText(input: string, algorithm: Digest): string {
  return bytesToHex(DIGESTS[algorithm](utf8ToBytes(input)));
}

export function hmacText(input: string, secret: string, algorithm: Digest): string {
  if (!secret) throw new Error("请输入密钥。");
  return bytesToHex(hmac(DIGESTS[algorithm], utf8ToBytes(secret), utf8ToBytes(input)));
}

export function base32Bytes(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z2-7]+)(={0,6})$/.exec(normalized);
  if (!match || ![0, 2, 4, 5, 7].includes(match[1].length % 8)
      || (match[2] && normalized.length % 8 !== 0)) throw new Error("Base32 密钥格式无效。");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const data = new Uint8Array(Math.floor(match[1].length * 5 / 8));
  let bits = 0;
  let count = 0;
  let offset = 0;
  for (const symbol of match[1]) {
    bits = (bits << 5) | alphabet.indexOf(symbol);
    count += 5;
    if (count >= 8) {
      count -= 8;
      data[offset++] = bits >> count;
      bits &= (1 << count) - 1;
    }
  }
  if (bits !== 0) throw new Error("Base32 密钥尾部的填充位无效。");
  return data;
}

export function makeTotp(secret: string, time: number, digits: 6 | 8 = 6, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  if (!Number.isSafeInteger(time) || time < 0) throw new Error("请输入有效的 Unix 秒数。");
  if (secret.length > 4096) throw new Error("TOTP 密钥过长。");
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(time / 30)));
  const bytes = hmac(DIGESTS[algorithm], base32Bytes(secret), counter);
  const offset = bytes[bytes.length - 1] & 15;
  const truncated = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset) & 0x7fffffff;
  return String(truncated % 10 ** digits).padStart(digits, "0");
}

export function generateBip39(words: number): string {
  if (![12, 15, 18, 21, 24].includes(words)) throw new Error("无效的 BIP39 单词数量。");
  return generateMnemonic(wordlist, words * 32 / 3);
}

function bcryptPassword(input: string): void {
  if (!input) throw new Error("请输入密码。");
  if (bcrypt.truncates(input)) throw new Error("bcrypt 密码最多支持 72 个 UTF-8 字节。");
}

export function bcryptHash(input: string, rounds: number): string {
  bcryptPassword(input);
  if (!Number.isInteger(rounds) || rounds < 4 || rounds > 12) throw new Error("bcrypt 成本参数须为 4 到 12。");
  return bcrypt.hashSync(input, rounds);
}

export function bcryptVerify(input: string, hash: string): string {
  bcryptPassword(input);
  const value = hash.trim();
  if (!/^\$2[aby]\$(0[4-9]|1[0-2])\$[./A-Za-z0-9]{53}$/.test(value)) {
    throw new Error("请输入有效的 bcrypt 哈希，支持成本 4 到 12。");
  }
  return bcrypt.compareSync(input, value) ? "密码匹配。" : "密码不匹配。";
}

const KDF_ITERATIONS = 600_000;
const MAX_CIPHER_INPUT = 128 * 1024;
const FORMAT = "dssh-aes256-gcm-v1";

function deriveKey(password: string, salt: Uint8Array) {
  if (!password || password.length > 4096) throw new Error("请输入不超过 4096 个字符的口令。");
  return pbkdf2(sha256, utf8ToBytes(password), salt, { c: KDF_ITERATIONS, dkLen: 32 });
}

export function encryptToolText(input: string, password: string): string {
  const data = utf8ToBytes(input);
  if (data.length > MAX_CIPHER_INPUT) throw new Error("明文最多支持 128 KiB。");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = deriveKey(password, salt);
  try {
    const ciphertext = gcm(key, nonce).encrypt(data);
    return [FORMAT, encodeBase64Bytes(salt), encodeBase64Bytes(nonce), encodeBase64Bytes(ciphertext)].join(".");
  } finally {
    key.fill(0);
    data.fill(0);
  }
}

export function decryptToolText(input: string, password: string): string {
  const fields = input.trim().split(".");
  if (fields.length !== 4 || fields[0] !== FORMAT || fields[3].length > Math.ceil((MAX_CIPHER_INPUT + 16) / 3) * 4) {
    throw new Error("密文格式无效，请粘贴此工具生成的完整密文。");
  }
  const [salt, nonce, ciphertext] = fields.slice(1).map(decodeBase64Bytes);
  if (salt.length !== 16 || nonce.length !== 12 || ciphertext.length < 16 || ciphertext.length > MAX_CIPHER_INPUT + 16) {
    throw new Error("密文格式无效。");
  }
  const key = deriveKey(password, salt);
  try {
    const data = gcm(key, nonce).decrypt(ciphertext);
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } finally {
      data.fill(0);
    }
  } catch {
    throw new Error("无法解密。请检查口令和密文是否完整。");
  } finally {
    key.fill(0);
  }
}
