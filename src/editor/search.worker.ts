import { searchText, type TextSearchQuery } from "./searchMatch";
self.onmessage = ({ data }: MessageEvent<{ content: string; query: TextSearchQuery; limit: number }>) => {
  try { self.postMessage({ result: searchText(data.content, data.query, data.limit) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "搜索失败。" }); }
};
