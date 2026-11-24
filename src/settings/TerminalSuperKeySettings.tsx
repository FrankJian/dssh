import { useState, useSyncExternalStore } from "react";
import { SettingsSwitch } from "../ui/SettingsSwitch";
import { getTerminalSuperKeyVisible, setTerminalSuperKeyVisible, subscribeTerminalSuperKey } from "./terminalSuperKeyStore";

export function TerminalSuperKeySettings() {
  const visible = useSyncExternalStore(subscribeTerminalSuperKey, getTerminalSuperKeyVisible);
  const [error, setError] = useState<string | null>(null);
  return <>
    <label className="terminal-settings__toggle-row">
      <span><strong>显示终端超级键</strong></span>
      <SettingsSwitch aria-label="显示终端超级键" checked={visible} onChange={(event) => {
        try {
          setTerminalSuperKeyVisible(event.currentTarget.checked);
          setError(null);
        } catch (error) {
          setError(error instanceof Error ? error.message : "保存终端超级键设置失败。");
        }
      }} />
    </label>
    {error && <p className="terminal-color-settings__error" role="alert">{error}</p>}
  </>;
}
