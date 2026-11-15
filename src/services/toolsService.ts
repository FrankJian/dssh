import { isTauri } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import { invokeCommand } from "./tauri";

export async function copyToolText(text: string): Promise<void> {
  if (isTauri()) await invokeCommand("plugin:clipboard-manager|write_text", { text });
  else await navigator.clipboard.writeText(text);
}

export async function copyToolImage(canvas: HTMLCanvasElement, png: Blob): Promise<void> {
  if (!isTauri()) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return;
  }
  const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const image = await Image.new(new Uint8Array(pixels.data.buffer), canvas.width, canvas.height);
  try {
    await invokeCommand("plugin:clipboard-manager|write_image", { image: image.rid });
  } finally {
    await image.close();
  }
}

export async function saveToolImage(png: Blob): Promise<boolean> {
  return invokeCommand<boolean>("save_tool_png", await png.arrayBuffer());
}

export async function hashToolText(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle && isTauri()) {
    return invokeCommand<string>("hash_tool_text", { text });
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
