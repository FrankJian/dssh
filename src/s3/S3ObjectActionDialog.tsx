import { useId, useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

interface S3ObjectActionLocation {
  profileId: string;
  bucket: string;
  prefix: string;
}
export type S3ObjectAction = S3ObjectActionLocation & (
  | { kind: "folder" }
  | { kind: "copy" | "move"; key: string; isFolder: boolean }
);

export function S3ObjectActionDialog({ action, onClose, onSubmit }: {
  action: S3ObjectAction;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const formId = useId();
  const folder = action.kind === "folder";
  const [value, setValue] = useState(folder ? "" : `${action.bucket}/${action.key}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const submitted = folder ? value.trim().replace(/^\/+|\/+$/g, "") : value;
    if (!submitted.trim()) { setError(folder ? "请输入文件夹名称。" : "请输入目标路径。"); return; }
    const slash = submitted.indexOf("/");
    if (!folder && (slash < 1 || slash === submitted.length - 1)) { setError("目标必须使用 bucket/key 格式。"); return; }
    setBusy(true); setError(null);
    try { await onSubmit(submitted); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "S3 操作失败，请重试。"); }
    finally { setBusy(false); }
  }
  const title = folder ? "新建文件夹" : action.kind === "move" ? "移动对象" : "复制对象";
  return <Dialog title={title} busy={busy} onClose={onClose} initialFocusSelector="input"
    footer={<>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button disabled={busy} variant="primary" type="submit" form={formId}>{busy ? "处理中…" : folder ? "创建" : action.kind === "move" ? "移动" : "复制"}</Button>
    </>}>
    <form className="app-dialog__form" id={formId} onSubmit={(event) => void submit(event)}>
      <p>{`s3://${action.bucket}/${folder ? action.prefix : action.key}`}</p>
      <label className="field"><span>{folder ? "文件夹名称" : "目标路径"}</span>
        <input disabled={busy} autoComplete="off" spellCheck={false} value={value} placeholder={folder ? "输入名称" : "bucket/path"}
          onChange={(event) => setValue(event.currentTarget.value)} />
      </label>
      {error ? <div className="form-errors" role="alert">{error}</div> : null}
    </form>
  </Dialog>;
}
