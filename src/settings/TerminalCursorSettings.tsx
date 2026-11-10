import { useState, useSyncExternalStore } from "react";
import { SelectMenu } from "../ui/SelectMenu";
import {
  getTerminalCursorPreferences,
  setTerminalCursorPreferences,
  subscribeTerminalCursorPreferences,
  type TerminalCursorPreferences,
  type TerminalCursorStyle,
} from "./terminalCursorStore";

export function TerminalCursorSettings() {
  const preferences = useSyncExternalStore(subscribeTerminalCursorPreferences, getTerminalCursorPreferences);
  const [error, setError] = useState<string | null>(null);
  function update(patch: Partial<TerminalCursorPreferences>) {
    try {
      setTerminalCursorPreferences(patch);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <section className="terminal-settings__group" aria-label="终端光标设置">
      <h4>光标</h4>
      <div className="terminal-settings__inline-field">
        <span className="settings-field__label">形状</span>
        <SelectMenu
          ariaLabel="终端光标形状"
          className="settings-select-menu"
          onChange={(value) => update({ cursorStyle: value as TerminalCursorStyle })}
          options={[
            { value: "bar", label: "竖线（│）" },
            { value: "underline", label: "下划线（_）" },
            { value: "thick-underline", label: "粗下划线（▂）" },
            { value: "block", label: "块状（▉）" },
          ]}
          selectOnArrowKeys
          value={preferences.cursorStyle}
        />
      </div>
      <label className="terminal-settings__toggle-row">
        <span><strong>光标闪烁</strong></span>
        <input aria-label="光标闪烁" checked={preferences.cursorBlink} onChange={(event) => update({ cursorBlink: event.currentTarget.checked })} type="checkbox" role="switch" />
      </label>
      <p className="settings-field__hint">修改即时生效。Vim 等程序可临时改变光标，退出后恢复此设置。</p>
      {error ? <p className="terminal-color-settings__error" role="alert">{error}</p> : null}
    </section>
  );
}
