import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { SegmentedControl } from "../ui/SegmentedControl";
import {
  getTerminalScrollback, setTerminalScrollback, subscribeTerminalScrollback,
  TERMINAL_SCROLLBACK_DEFAULT, TERMINAL_SCROLLBACK_MAX,
} from "./terminalScrollbackStore";

export function TerminalScrollbackSettings() {
  const lines = useSyncExternalStore(subscribeTerminalScrollback, getTerminalScrollback);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const preset = custom || draft !== null ? "custom" : lines === 0 ? "0" : lines === TERMINAL_SCROLLBACK_DEFAULT ? "2000" : lines === 10000 ? "10000" : "custom";
  function save(value: number) {
    try {
      setTerminalScrollback(value);
      setDraft(null);
      setError(null);
      setCustom(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存滚动历史设置失败。");
    }
  }
  function commit(text: string) {
    if (!text.trim()) { setDraft(null); setError(null); return; }
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > TERMINAL_SCROLLBACK_MAX) {
      setError("请输入 0～100,000 之间的整数。");
      return;
    }
    save(value);
  }
  return (
    <section className="terminal-settings__group terminal-scrollback-settings" aria-label="终端滚动历史设置">
      <header className="terminal-settings__group-head">
        <h4>输出历史</h4>
        <IconButton label="恢复默认（2,000 行）" disabled={lines === TERMINAL_SCROLLBACK_DEFAULT && draft === null && !custom}
          onClick={() => save(TERMINAL_SCROLLBACK_DEFAULT)}><Icon name="refresh" width="14" height="14" /></IconButton>
      </header>
      <SegmentedControl label="输出历史预设" value={preset} options={[
        { value: "0", label: "不保留" },
        { value: "2000", label: "2,000 行" },
        { value: "10000", label: "10,000 行" },
        { value: "custom", label: "自定义" },
      ]} onChange={(value) => {
        if (value === "custom") {
          setCustom(true);
          inputRef.current?.focus();
          inputRef.current?.select();
        } else save(Number(value));
      }} />
      <label className="terminal-scrollback-settings__row" htmlFor={id}>
        <span className="settings-field__label">可回看行数</span>
        <span className="terminal-scrollback-settings__controls" data-invalid={Boolean(error)}>
          <input ref={inputRef} id={id} type="number" min={0} max={TERMINAL_SCROLLBACK_MAX} step={1}
            aria-label="终端滚动历史行数" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
            value={draft ?? String(lines)} onChange={event => { setDraft(event.currentTarget.value); setError(null); }}
            onBlur={event => commit(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
              else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); setError(null); setCustom(false); }
            }} />
          <span aria-hidden="true">行</span>
        </span>
      </label>
      {error ? <p className="terminal-color-settings__error" role="alert" id={`${id}-error`}>{error}</p> : null}
    </section>
  );
}
