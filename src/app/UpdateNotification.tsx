import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface UpdateNotificationProps {
  update: Update;
  onDismiss: () => void;
}

type InstallState =
  | { phase: "ready" }
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" }
  | { phase: "error"; message: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

export function UpdateNotification({ update, onDismiss }: UpdateNotificationProps) {
  const [install, setInstall] = useState<InstallState>({ phase: "ready" });
  const isInstalling = install.phase === "downloading" || install.phase === "installing";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isInstalling) {
        onDismiss();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isInstalling, onDismiss]);

  async function handleInstall() {
    let downloaded = 0;
    let total: number | null = null;
    setInstall({ phase: "downloading", downloaded, total });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
        } else {
          setInstall({ phase: "installing" });
          return;
        }
        setInstall({ phase: "downloading", downloaded, total });
      });
      setInstall({ phase: "installing" });
      await relaunch();
    } catch (error) {
      setInstall({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section aria-describedby="update-notification-description" aria-labelledby="update-notification-title" aria-modal="true" className="update-notification" role="dialog">
        <header className="update-notification__header">
          <Icon name="download" height="18" width="18" />
          <h2 id="update-notification-title">发现新版本</h2>
        </header>
        <div className="update-notification__body">
          <p id="update-notification-description">
            Duo SSH {update.version} 已可用。下载并安装后，应用会自动重启到新版本。
          </p>
          {update.body ? <p className="update-notification__notes">{update.body}</p> : null}

          {install.phase === "downloading" ? (
            <div aria-live="polite" className="update-notification__progress">
              <div className="update-notification__progress-label">正在下载更新…</div>
              <div className="about-update__track">
                <div
                  className="about-update__bar"
                  data-indeterminate={install.total == null}
                  style={
                    install.total
                      ? { width: `${Math.min(100, Math.round((install.downloaded / install.total) * 100))}%` }
                      : undefined
                  }
                />
              </div>
              <div className="about-update__meta">
                {formatSize(install.downloaded)}
                {install.total != null ? ` / ${formatSize(install.total)}` : ""}
              </div>
            </div>
          ) : null}

          {install.phase === "installing" ? (
            <div aria-live="polite" className="update-notification__status">安装完成，正在重启应用…</div>
          ) : null}

          {install.phase === "error" ? (
            <div className="update-notification__error" role="alert">安装更新失败：{install.message}</div>
          ) : null}
        </div>
        <footer className="update-notification__actions">
          <Button disabled={isInstalling} onClick={onDismiss} variant="ghost">稍后</Button>
          <Button autoFocus disabled={isInstalling} onClick={() => void handleInstall()} variant="primary">
            {install.phase === "ready" || install.phase === "error" ? "立即更新" : "正在安装…"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
