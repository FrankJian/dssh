import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const appWindow = getCurrentWindow();

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const sync = () => {
      appWindow
        .isMaximized()
        .then(setMaximized)
        .catch(() => {});
    };

    sync();
    appWindow
      .onResized(sync)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="window-controls">
      <button
        aria-label="最小化"
        className="window-control"
        onClick={() => void appWindow.minimize()}
        type="button"
      >
        <Icon name="minimize" />
      </button>
      <button
        aria-label={maximized ? "还原" : "最大化"}
        className="window-control"
        onClick={() => void appWindow.toggleMaximize()}
        type="button"
      >
        <Icon name={maximized ? "restore" : "maximize"} />
      </button>
      <button
        aria-label="关闭"
        className="window-control window-control--close"
        onClick={() => void appWindow.close()}
        type="button"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
