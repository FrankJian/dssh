import { useState } from "react";
import type { JumpServerProfile } from "../models/jumpserver";
import { useDialogFocus } from "../rdp/useDialogFocus";
import { Button } from "../ui/Button";

export function JumpServerDeleteDialog({ profile, onClose, onDelete }: {
  profile: JumpServerProfile; onClose: () => void; onDelete: () => Promise<void>;
}) {
  const ref = useDialogFocus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="profile-editor-backdrop" role="presentation">
    <section ref={ref} className="profile-editor is-glass-overlay jumpserver__confirm" role="dialog" aria-modal="true" aria-label="删除 JumpServer 连接"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
      <h2>删除 JumpServer 连接</h2><p>删除“{profile.name}”及其保存的 API Secret？此操作无法撤销，不会删除服务端账号或资产。已登录的平台需先退出登录。</p>
      {error && <p className="form-errors" role="alert">{error}</p>}
      <footer><Button autoFocus disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy} onClick={() => {
        setBusy(true); setError(""); void onDelete().catch((e: unknown) => setError(e instanceof Error ? e.message : "删除失败。")).finally(() => setBusy(false));
      }}>{busy ? "正在删除…" : "删除连接"}</Button></footer>
    </section>
  </div>;
}
