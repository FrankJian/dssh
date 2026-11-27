import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

/** Keep fast refreshes perceptible without delaying the underlying operation. */
export function EditorRefreshButton({ label, busy, disabled = false, onRefresh }: {
  label: string; busy: boolean; disabled?: boolean; onRefresh(): void;
}) {
  const [pulse, setPulse] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return <IconButton label={label} title={busy ? "正在刷新…" : label} disabled={disabled || busy}
    aria-busy={busy} className={`editor-refresh-button${busy || pulse ? " is-refreshing" : ""}`}
    onClick={() => {
      if (timer.current !== null) clearTimeout(timer.current);
      setPulse(value => value + 1);
      timer.current = setTimeout(() => { timer.current = null; setPulse(0); }, 600);
      onRefresh();
    }}><Icon key={pulse} name="refreshCw" /></IconButton>;
}
