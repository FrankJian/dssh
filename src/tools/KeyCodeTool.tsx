import { useId, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { copyToolText } from "../services/toolsService";
import { ToolFeedback, ToolPanel } from "./ToolControls";

export default function KeyCodeTool() {
  const captureId = useId();
  const outputId = useId();
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="tool-form">
      <div className="tool-form__grid">
        <div className="tool-form__column">
          <ToolPanel label="按键测试区" htmlFor={captureId}>
            <input id={captureId} value="" readOnly placeholder="聚焦这里后按键"
              onKeyDown={(event) => {
                if (event.key === "Tab" || event.key === "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                const { key, code, location, altKey, ctrlKey, metaKey, shiftKey, repeat } = event;
                setResult(JSON.stringify({ key, code, location, altKey, ctrlKey, metaKey, shiftKey, repeat }, null, 2));
                setStatus("");
                setError("");
              }} />
          </ToolPanel>
        </div>
        <ToolPanel label="键盘事件" htmlFor={outputId} actions={
          <Button variant="ghost" disabled={!result} onClick={() => {
            setStatus("");
            setError("");
            void copyToolText(result).then(() => setStatus("已复制结果。"), () => setError("无法复制按键结果。"));
          }}><Icon name="copy" /> 复制结果</Button>
        }>
          <textarea id={outputId} value={result} readOnly spellCheck={false} />
        </ToolPanel>
      </div>
      <ToolFeedback error={error} status={status} />
    </div>
  );
}
