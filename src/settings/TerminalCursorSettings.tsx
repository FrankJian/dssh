import { useId, useState, useSyncExternalStore } from "react";
import { SettingsSwitch } from "../ui/SettingsSwitch";
import {
  getTerminalCursorPreferences,
  setTerminalCursorPreferences,
  subscribeTerminalCursorPreferences,
  type TerminalCursorPreferences,
  type TerminalCursorStyle,
} from "./terminalCursorStore";

const cursorStyles: { value: TerminalCursorStyle; label: string }[] = [
  { value: "bar", label: "竖线" },
  { value: "underline", label: "下划线" },
  { value: "thick-underline", label: "粗下划线" },
  { value: "block", label: "块状" },
];

export function TerminalCursorSettings() {
  const shapeGroupId = useId();
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
      <div className="settings-field">
        <span className="settings-field__label" id={shapeGroupId}>形状</span>
        <div className="terminal-cursor-shapes" role="radiogroup" aria-labelledby={shapeGroupId}>
          {cursorStyles.map(({ value, label }) => (
            <label className="terminal-cursor-shapes__option" key={value}>
              <input
                type="radio"
                name={shapeGroupId}
                value={value}
                checked={preferences.cursorStyle === value}
                onChange={() => update({ cursorStyle: value })}
              />
              <span className="terminal-cursor-shapes__glyph" data-shape={value} aria-hidden="true" />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="terminal-settings__toggle-row">
        <span><strong>光标闪烁</strong></span>
        <SettingsSwitch aria-label="光标闪烁" checked={preferences.cursorBlink} onChange={(event) => update({ cursorBlink: event.currentTarget.checked })} />
      </label>
      {error ? <p className="terminal-color-settings__error" role="alert">{error}</p> : null}
    </section>
  );
}
