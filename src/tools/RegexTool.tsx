import { useState } from "react";
import { TextTool } from "./ToolForm";
import RegexWorker from "./regex.worker?worker";

function runRegex(pattern: string, flags: string, input: string): Promise<string> {
  if (pattern.length > 2048) throw new Error("正则表达式最多支持 2048 个字符。");
  return new Promise((resolve, reject) => {
    const worker = new RegexWorker();
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("匹配超时，请简化表达式或缩短测试文本。"));
    }, 1500);
    function finish() {
      window.clearTimeout(timeout);
      worker.terminate();
    }
    worker.onmessage = ({ data }: MessageEvent<{ result: string } | { error: string }>) => {
      finish();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("无法运行正则匹配。"));
    };
    worker.postMessage({ pattern, flags, input });
  });
}

export default function RegexTool() {
  const [flags, setFlags] = useState("gm");
  return (
    <TextTool
      action="查找匹配"
      inputLabel="正则表达式"
      inputType="text"
      example={String.raw`^Port\s+(\d+)`}
      secondInput={{ label: "测试文本", example: "Host dev\nPort 22\nHost qa\nPort 2200" }}
      outputLabel="匹配结果"
      resultKey={flags}
      options={
        <label className="tool-form__setting">标志
          <input className="tool-form__short-input" value={flags} maxLength={8} spellCheck={false} onChange={(event) => setFlags(event.target.value)} />
        </label>
      }
      run={(pattern, input) => runRegex(pattern, flags, input)}
    />
  );
}
