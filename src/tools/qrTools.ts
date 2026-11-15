import QRCode from "qrcode";
import { canvasPng } from "./textImage.ts";

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export function wifiQrPayload(ssid: string, password: string, security: WifiSecurity, hidden: boolean): string {
  const byteLength = (value: string) => new TextEncoder().encode(value).length;
  if (!ssid || byteLength(ssid) > 32 || /[\r\n\0]/.test(ssid)) throw new Error("网络名称须为 1–32 个 UTF-8 字节。");
  if (security !== "nopass" && (!password || byteLength(password) > 128 || /[\r\n\0]/.test(password))) {
    throw new Error("请输入有效的 Wi-Fi 密码。");
  }
  const escape = (value: string) => value.replace(/[\\;,:"]/g, (character) => "\\" + character);
  return `WIFI:T:${security};S:${escape(ssid)};${security === "nopass" ? "" : `P:${escape(password)};`}${hidden ? "H:true;" : ""};`;
}

export function qrSymbol(input: string, level: QRCode.QRCodeErrorCorrectionLevel) {
  if (!input.trim()) throw new Error("请输入二维码内容。");
  const bytes = new TextEncoder().encode(input);
  if (bytes.length > 2048) throw new Error("二维码内容最多支持 2 KiB。");
  try {
    // One UTF-8 byte segment bounds the encoding cost and preserves the exact input.
    return QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: level });
  } catch {
    throw new Error("内容超出此纠错等级的二维码容量。");
  }
}

export async function renderQrCode(input: string, level: QRCode.QRCodeErrorCorrectionLevel) {
  const symbol = qrSymbol(input, level);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("当前窗口无法生成图片。");
  const scale = 5;
  const quiet = 4;
  const size = symbol.modules.size;
  canvas.width = canvas.height = (size + quiet * 2) * scale;
  const style = getComputedStyle(document.documentElement);
  context.fillStyle = style.getPropertyValue("--tool-qr-bg").trim();
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = style.getPropertyValue("--tool-qr-fg").trim();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (symbol.modules.get(y, x)) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
  return { canvas, png: await canvasPng(canvas) };
}
