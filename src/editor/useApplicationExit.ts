import { useEffect, useRef } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "../ui/ToastHost";
import type { prepareEditorWindowClose } from "./closeWorkspace";
type Prepared = NonNullable<Awaited<ReturnType<typeof prepareEditorWindowClose>>>;
type Request = { ownerLabel: string; requestId: string; phase: "prepare" | "validate" | "commit" | "abort" };

/** Only request IDs and decisions cross windows; drafts remain owned by their workbench. */
export function useApplicationExit(prepare: () => Promise<Prepared | null>, cancelDialogs: () => void, locked = false) {
  const actions = useRef({ prepare, cancelDialogs }); actions.current = { prepare, cancelDialogs };
  const pending = useRef(false);
  useEffect(() => {
    if (!isTauri() || locked) return;
    let alive = true; let id: string | null = null; let prepared: Prepared | null = null;
    let previousInert = false; let ownsInert = false;
    const reset = () => {
      id = null; pending.current = false; prepared?.cancel(); prepared = null;
      if (ownsInert) { document.body.inert = previousInert; ownsInert = false; }
    };
    const webview = getCurrentWebview();
    const subscription = webview.listen<Request>("workspace://application-exit", ({ payload }) => {
      void (async () => {
        if (payload.ownerLabel !== webview.label) return;
        const { requestId, phase } = payload;
        if (phase === "abort") {
          if (id === requestId) { actions.current.cancelDialogs(); reset(); toast("退出已取消，未关闭的工作内容已保留。", "info"); }
          return;
        }
        let accepted = false;
        try {
          if (phase === "prepare" && !id) {
            id = requestId; pending.current = true;
            toast("正在检查此窗口的未保存修改…", "info");
            const plan = await actions.current.prepare();
            if (!alive || id !== requestId) { plan?.cancel(); return; }
            prepared = plan; accepted = !!plan;
            if (plan) { toast("正在等待其他窗口确认退出…", "info"); previousInert = document.body.inert; ownsInert = true; document.body.inert = true; }
          } else if (id === requestId && phase === "validate") accepted = !!prepared?.valid();
          else if (id === requestId && phase === "commit" && prepared?.valid()) { await prepared.commit(); accepted = true; }
        } catch (error) { toast(error instanceof Error ? error.message : "退出准备失败，请重试。", "error"); }
        if (alive) await invoke("application_exit_reply", { requestId, phase, accepted });
      })().catch(() => { reset(); toast("退出协调失败，应用已保留，请重试。", "error"); });
    });
    return () => { alive = false; actions.current.cancelDialogs(); reset(); void subscription.then(stop => stop()).catch(() => {}); };
  }, [locked]);
  return pending;
}
