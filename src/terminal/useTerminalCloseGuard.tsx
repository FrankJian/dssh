import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";

/** One decision per terminal window, also used by bulk close and pane actions. */
export function useTerminalCloseGuard(running: ReadonlySet<string>) {
  const runningRef = useRef(running);
  runningRef.current = running;
  const [title, setTitle] = useState<string | null>(null);
  const decision = useRef<((confirmed: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const decide = useCallback((confirmed: boolean) => {
    decision.current?.(confirmed);
    decision.current = null;
    setTitle(null);
  }, []);

  useEffect(() => () => { decision.current?.(false); }, []);
  useEffect(() => {
    if (title === null) return;
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        decide(false);
      } else if (event.key === "Tab") {
        const buttons = cancelRef.current?.parentElement?.querySelectorAll<HTMLButtonElement>("button");
        if (!buttons?.length) return;
        event.preventDefault();
        const index = [...buttons].indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [decide, title]);

  const confirmClose = useCallback((sessionIds: string[], label: string): Promise<boolean> => {
    if (decision.current) return Promise.resolve(false);
    if (!sessionIds.some((id) => runningRef.current.has(id))) return Promise.resolve(true);
    return new Promise((resolve) => {
      decision.current = resolve;
      setTitle(label);
    });
  }, []);

  const closeDialog = title === null ? null : createPortal(
    <div className="profile-editor-backdrop" role="presentation">
      <section aria-label="确认关闭运行中的终端" aria-modal="true" className="detached-close-dialog" role="alertdialog">
        <header className="profile-editor__topbar"><h2>任务仍在运行</h2></header>
        <div className="detached-close-dialog__body">
          <p>“{title}”中有任务正在运行，关闭会中断任务。是否继续关闭？</p>
          <footer className="s3-dialog-actions">
            <button className="button button--secondary" onClick={() => decide(false)} ref={cancelRef} type="button">保留窗口</button>
            <Button onClick={() => decide(true)} variant="primary">关闭并中断任务</Button>
          </footer>
        </div>
      </section>
    </div>, document.body,
  );
  return { confirmClose, closeDialog };
}
