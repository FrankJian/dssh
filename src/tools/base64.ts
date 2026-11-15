export function encodeBase64(input: string): string {
  return encodeBase64Bytes(new TextEncoder().encode(input));
}

export function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export function decodeBase64Bytes(input: string): Uint8Array {
  return Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
}

export function decodeBase64(input: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeBase64Bytes(input));
  } catch {
    throw new Error("请输入有效的 Base64 编码 UTF-8 文本。");
  }
}
