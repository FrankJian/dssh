import { useEffect, useRef, type ReactNode } from "react";

/** Native modal isolation keeps keyboard focus away from both file panes. */
export function SftpDialog({
  children,
  onCancel,
  busy = false,
}: {
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sftp-modal"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      {children}
    </dialog>
  );
}
