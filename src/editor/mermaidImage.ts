import { canvasPng } from "../tools/textImage.ts";

export const MAX_MERMAID_TEXT = 64 * 1024;
export function validateMermaidSource(chart: string): void {
  if (!chart.trim()) throw new Error("图表内容为空。");
  if (new TextEncoder().encode(chart).byteLength > MAX_MERMAID_TEXT) throw new Error("图表超过 64 KiB，请拆分后预览。");
  if (chart.split(/[\n;&]/).length > 1000) throw new Error("图表超过 1,000 行或分句，请拆分后预览。");
  const inspected = chart.replace(/\\([a-f\d]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/\\(.)/g, "$1").replace(/&#(x[a-f\d]+|\d+);?/gi, (_, value: string) => String.fromCodePoint(Math.min(parseInt(value.replace(/^x/i, ""), /^x/i.test(value) ? 16 : 10), 0x10ffff)))
    .replace(/&colon;/gi, ":").replace(/&sol;/gi, "/");
  if (/%%\s*\{|^\s*---\s*$/m.test(inspected)) throw new Error("预览不接受图表内的配置指令，请仅保留图表正文。");
  if (/(?:https?|file|data|javascript|vbscript|ftp):|\/\/|url\s*\(|@import|\bimg\s*:|<\s*(?:img|image)\b|!\[[^\]]*\]\s*\(/i.test(inspected)) {
    throw new Error("图表包含外部资源或图片，请移除后预览。");
  }
}
export function diagramRasterSize(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 100000)) throw new Error("图表尺寸无效或过大。");
  // The shared native PNG writer accepts at most 1024 × 4096 pixels.
  const scale = Math.min(2, 1024 / width, 4096 / height);
  return { width: Math.min(1024, Math.max(1, Math.round(width * scale))), height: Math.min(4096, Math.max(1, Math.round(height * scale))) };
}
export async function mermaidPng(svg: string, background: string): Promise<Blob> {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) throw new Error("图表图片无效，请重新预览。");
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const size = diagramRasterSize(viewBox?.[2] ?? Number(root.getAttribute("width")), viewBox?.[3] ?? Number(root.getAttribute("height")));
  root.removeAttribute("style"); root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.setAttribute("width", String(size.width)); root.setAttribute("height", String(size.height));
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("图表图片转换超时，请重试。")), 10000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error("无法转换图表图片，请重试。")); };
      image.src = url;
    });
    const canvas = globalThis.document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("当前窗口无法生成图片。");
    context.fillStyle = background; context.fillRect(0, 0, size.width, size.height); context.drawImage(image, 0, 0, size.width, size.height);
    return await canvasPng(canvas);
  } finally { URL.revokeObjectURL(url); }
}
