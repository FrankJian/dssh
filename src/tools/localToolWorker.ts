export type LocalToolJob = { id: string; input: string; other: string; option: string };
type Reply = { result: string } | { error: string };

export function runLocalTool(createWorker: () => Worker, job: LocalToolJob): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    function finish() {
      clearTimeout(timer);
      worker.terminate();
    }
    const timer = setTimeout(() => {
      finish();
      reject(new Error("处理超时，请缩短输入或降低运算成本。"));
    }, 15_000);
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      finish();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("无法运行本地工具。"));
    };
    worker.postMessage(job);
  });
}

export function receiveLocalTool(run: (job: LocalToolJob) => string) {
  self.onmessage = ({ data }: MessageEvent<LocalToolJob>) => {
    try {
      const result = run(data);
      if (result.length > 2 * 1024 * 1024) throw new Error("输出过大，请分批处理。");
      self.postMessage({ result });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : "输入无法处理。" });
    }
  };
}
