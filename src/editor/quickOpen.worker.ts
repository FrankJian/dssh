import { quickOpenMatches, type QuickOpenItem } from "./quickOpen";
self.onmessage = ({ data }: MessageEvent<{ items: QuickOpenItem[]; query: string }>) => {
  try { self.postMessage({ items: quickOpenMatches(data.items, data.query) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "文件名匹配失败。" }); }
};
