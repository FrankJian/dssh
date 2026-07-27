import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type ToastKind = "info" | "success" | "warning" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const listeners = new Set<(toast: Toast) => void>();
let counter = 1;

/** Show a transient, non-blocking notification. Safe to call from anywhere. */
export function toast(message: string, kind: ToastKind = "info") {
  const entry: Toast = { id: counter, kind, message };
  counter += 1;
  for (const listener of listeners) {
    listener(entry);
  }
}

const KIND_ICON: Record<ToastKind, IconName> = {
  info: "info",
  success: "check",
  warning: "shield",
  error: "close",
};

/** Renders queued toasts. Mount once near the app root. */
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (entry: Toast) => {
      setToasts((current) => [...current, entry]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== entry.id));
      }, 4200);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div className="toast" data-kind={item.kind} key={item.id}>
          <Icon name={KIND_ICON[item.kind]} height="15" width="15" />
          <span className="toast__message">{item.message}</span>
          <button
            className="toast__close"
            onClick={() => setToasts((current) => current.filter((x) => x.id !== item.id))}
            aria-label="关闭"
            type="button"
          >
            <Icon name="close" height="12" width="12" />
          </button>
        </div>
      ))}
    </div>
  );
}
