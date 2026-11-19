import { useId, useState, type ReactNode } from "react";
import { ToolAction, ToolFeedback, ToolPanel, ToolToolbar } from "./ToolControls";
import { copyToolText } from "../services/toolsService";

const TEXT_INPUT_LIMIT = 256 * 1024;

export function toolError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

interface TextToolProps {
  inputLabel?: string;
  inputType?: "text" | "password";
  outputLabel: string;
  multilineOutput?: boolean;
  example?: string;
  action: string;
  options?: ReactNode;
  resultKey?: string | number;
  secondInput?: { label: string; example: string; type?: "text" | "password" };
  run: (input: string, other: string) => string | Promise<string>;
}

export function TextTool({ inputLabel, inputType, outputLabel, multilineOutput = Boolean(inputLabel), example, action, options, resultKey, secondInput, run }: TextToolProps) {
  const outputId = useId();
  const [input, setInput] = useState("");
  const [other, setOther] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [previousKey, setPreviousKey] = useState(resultKey);
  if (previousKey !== resultKey) {
    setPreviousKey(resultKey);
    setOutput(null);
    setError("");
    setStatus("");
  }

  function edit(next: string, right = other) {
    setInput(next);
    setOther(right);
    setOutput(null);
    setError("");
    setStatus("");
  }

  async function process() {
    setError("");
    setStatus("");
    setOutput(null);
    if (input.length > TEXT_INPUT_LIMIT || other.length > TEXT_INPUT_LIMIT) {
      setError("每个输入最多支持 262,144 个 UTF-16 代码单元。");
      return;
    }
    setBusy(true);
    try {
      setOutput(await run(input, other));
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
      setStatus("已复制结果。");
    } catch {
      setStatus("复制失败，请重试或手动选择结果复制。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool-form" aria-busy={busy}>
      <ToolToolbar
        options={options}
        busy={busy}
        action={action}
        onRun={() => void process()}
        onExample={example === undefined ? undefined : () => edit(example, secondInput?.example ?? "")}
        onClear={inputLabel ? () => edit("", "") : undefined}
        canClear={Boolean(input || other || output !== null)}
      />
      <div className={inputLabel ? "tool-form__grid" : "tool-form__result-only"}>
        {inputLabel ? (
          <div className="tool-form__column">
            <ToolInput label={inputLabel} type={inputType} value={input} readOnly={busy} onChange={edit} />
            {secondInput ? (
              <ToolInput label={secondInput.label} type={secondInput.type} value={other} readOnly={busy}
                onChange={(value) => edit(input, value)} />
            ) : null}
          </div>
        ) : null}
        <ToolPanel
          expandable
          feedback={{ error, status }}
          label={outputLabel}
          htmlFor={outputId}
          actions={
            <ToolAction variant="ghost" label="复制结果" icon="copy" onClick={() => void copy()} disabled={output === null || busy} />
          }
        >
          {multilineOutput ? (
            <textarea id={outputId} value={output ?? ""} spellCheck={false} readOnly placeholder="运行后显示结果" />
          ) : (
            <input id={outputId} value={output ?? ""} readOnly placeholder="运行后显示结果" />
          )}
        </ToolPanel>
      </div>
      <ToolFeedback error={error} status={status} />
    </div>
  );
}

function ToolInput({ label, type, value, readOnly, onChange }: {
  label: string;
  type?: "text" | "password";
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <ToolPanel label={label} htmlFor={id}>
      {type ? (
        <input id={id} type={type} autoComplete="off" spellCheck={false} value={value} readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)} />
      ) : (
        <textarea id={id} spellCheck={false} value={value} readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)} />
      )}
    </ToolPanel>
  );
}
