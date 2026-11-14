import { useEffect, useState } from "react";
import { BROWSER_LINK_TARGET_KEY, getBrowserLinkTarget, parseBrowserLinkTarget } from "../browser/browserPreferences";
import { SelectMenu } from "../ui/SelectMenu";

export function BrowserLinkSettings() {
  const [target, setTarget] = useState(getBrowserLinkTarget);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === BROWSER_LINK_TARGET_KEY) setTarget(parseBrowserLinkTarget(event.newValue)); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <section className="terminal-settings__group" aria-label="终端链接设置">
    <h4>终端链接</h4>
    <label className="settings-field__label">点击 URL 时使用</label>
    <SelectMenu ariaLabel="终端链接打开方式" className="settings-select-menu" value={target}
      options={[{ value: "builtin", label: "内置浏览器（标签页）" }, { value: "system", label: "系统默认浏览器" }, { value: "chrome", label: "Google Chrome" }, { value: "edge", label: "Microsoft Edge" }]}
      onChange={(value) => { const next = parseBrowserLinkTarget(value); localStorage.setItem(BROWSER_LINK_TARGET_KEY, next); setTarget(next); }} />
  </section>;
}
