import { useEffect, useId, useState, type ReactNode } from "react";
import { copyToolImage, saveToolImage } from "../services/toolsService";
import { Icon } from "../ui/Icon";
import { ToolAction, ToolFeedback, ToolPanel, ToolToolbar } from "./ToolControls";
import { toolError } from "./ToolForm";
import { renderTextImage } from "./textImage";

interface ImageExportToolProps {
  inputLabel: string;
  previewAlt: string;
  example: string;
  options?: ReactNode;
  revision?: string;
  render: (input: string) => Promise<{ canvas: HTMLCanvasElement; png: Blob }>;
}

export function ImageExportTool({ inputLabel, previewAlt, example, options, revision, render }: ImageExportToolProps) {
  const inputId = useId();
  const [input, setInput] = useState("");
  const [image, setImage] = useState<(Awaited<ReturnType<typeof renderTextImage>> & { url: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [previousRevision, setPreviousRevision] = useState(revision);
  if (previousRevision !== revision) {
    setPreviousRevision(revision);
    setImage(null);
    setError("");
    setStatus("");
  }

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.url);
    };
  }, [image]);

  function edit(value: string) {
    setInput(value);
    setImage(null);
    setError("");
    setStatus("");
  }

  async function operate(action: "generate" | "copy" | "save") {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      if (action === "generate") {
        setImage(null);
        const result = await render(input);
        setImage({ ...result, url: URL.createObjectURL(result.png) });
      } else if (image && action === "copy") {
        await copyToolImage(image.canvas, image.png);
        setStatus("已复制图片。");
      } else if (image && await saveToolImage(image.png)) {
        setStatus("已保存 PNG。");
      }
    } catch (failure) {
      setError(toolError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool-form" aria-busy={busy}>
      <ToolToolbar busy={busy} action="生成图片" options={options} canClear={Boolean(input)}
        onExample={() => edit(example)} onClear={() => edit("")} onRun={() => void operate("generate")} />
      <div className="tool-form__grid">
        <ToolPanel label={inputLabel} htmlFor={inputId}>
          <textarea id={inputId} spellCheck={false} value={input} readOnly={busy}
            onChange={(event) => edit(event.currentTarget.value)} />
        </ToolPanel>
        <ToolPanel label="图片预览" expandable feedback={{ error, status }} actions={
          <>
            <ToolAction variant="ghost" label="复制图片" icon="copy" disabled={!image || busy} onClick={() => void operate("copy")} />
            <ToolAction variant="ghost" label="另存为 PNG" icon="download" disabled={!image || busy} onClick={() => void operate("save")} />
          </>
        }>
          <div className="tool-form__preview">
            {image ? <img src={image.url} alt={previewAlt} /> : (
              <div className="tool-form__preview-empty"><Icon name="fileImage" /><span>生成后在此预览</span></div>
            )}
          </div>
        </ToolPanel>
      </div>
      <ToolFeedback error={error} status={status} />
    </div>
  );
}


const EXAMPLE = "Duo SSH 工具箱\n\n  $ hostname\n  demo-server\n\n连接就绪 ✅";

export default function TextImageTool() {
  return (
    <ImageExportTool inputLabel="文本输入" previewAlt="根据输入生成的文字图片" example={EXAMPLE}
      render={(input) => {
        const style = getComputedStyle(document.documentElement);
        return renderTextImage(input, style.getPropertyValue("--tool-image-bg").trim(),
          style.getPropertyValue("--tool-image-fg").trim());
      }} />
  );
}
