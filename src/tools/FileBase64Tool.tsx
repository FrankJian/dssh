import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { copyToolText } from "../services/toolsService";
import { encodeBase64Bytes } from "./base64";
import { ToolFeedback, ToolPanel } from "./ToolControls";
import { toolError } from "./ToolForm";

export default function FileBase64Tool() {
  const fileInput = useRef<HTMLInputElement>(null);
  const outputId = useId();
  const [name, setName] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function read(file: File) {
    setName(file.name);
    setOutput(null);
    setStatus("");
    setError("");
    if (file.size > 2 * 1024 * 1024) {
      setError("文件最多支持 2 MiB。");
      return;
    }
    setBusy(true);
    try {
      setOutput(encodeBase64Bytes(new Uint8Array(await file.arrayBuffer())));
    } catch (failure) {
      setError(toolError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (output === null) return;
    setBusy(true);
    setStatus("");
    try {
      await copyToolText(output);
      setStatus("已复制 Base64。");
    } catch {
      setStatus("复制失败，请手动选择结果复制。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool-form" aria-busy={busy}>
      <div className="tool-form__toolbar">
        <Button variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          选择文件
        </Button>
        <span>{name || "最大 2 MiB"}</span>
        <input hidden type="file" ref={fileInput} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void read(file);
        }} />
      </div>
      <ToolPanel label="Base64" htmlFor={outputId} actions={
        <Button variant="ghost" disabled={busy || output === null} onClick={() => void copy()}>
          <Icon name="copy" />复制结果
        </Button>
      }>
        <textarea id={outputId} readOnly spellCheck={false} value={output ?? ""} />
      </ToolPanel>
      <ToolFeedback error={error} status={status} />
    </div>
  );
}
