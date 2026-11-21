import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/** Resolve only after the modal closes, so sequential confirmations cannot
 * reuse a destructive action's focus or leave an abandoned request pending. */
export function useConfirmation() {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const requestConfirmation = useCallback((next: ConfirmationOptions): Promise<boolean> => {
    if (resolver.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);
  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    flushSync(() => setOptions(null));
    resolve?.(confirmed);
  }, []);
  useEffect(() => () => {
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(false);
  }, []);

  const confirmationDialog = options ? <Dialog
    title={options.title}
    initialFocusSelector="[data-confirm-cancel]"
    onClose={() => settle(false)}
    footer={<>
      <Button data-confirm-cancel onClick={() => settle(false)}>{options.cancelLabel ?? "取消"}</Button>
      <Button variant={options.destructive ? "danger" : "primary"} onClick={() => settle(true)}>{options.confirmLabel ?? "确认"}</Button>
    </>}
  >
    <p>{options.message}</p>
  </Dialog> : null;
  return { requestConfirmation, confirmationDialog };
}
