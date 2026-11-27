import SearchWorker from "./search.worker?worker";
import type { TextSearchQuery, TextSearchResult } from "./searchMatch";
export function searchInWorker(content: string, query: TextSearchQuery, limit: number, signal: AbortSignal): Promise<TextSearchResult> {
  if (signal.aborted) return Promise.reject(new DOMException("已取消", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new SearchWorker(); let finished = false;
    const finish = () => { if (finished) return false; finished = true; clearTimeout(timeout); signal.removeEventListener("abort", abort); worker.terminate(); return true; };
    const abort = () => { if (finish()) reject(new DOMException("已取消", "AbortError")); };
    const timeout = setTimeout(() => { if (finish()) reject(new Error("此文件的正则匹配超过 1 秒，已停止。")); }, 1000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ result?: TextSearchResult; error?: string }>) => { if (!finish()) return; if (data.result) resolve(data.result); else reject(new Error(data.error ?? "搜索失败。")); };
    worker.onerror = () => { if (finish()) reject(new Error("搜索 worker 无法运行。")); };
    worker.postMessage({ content, query, limit });
  });
}
