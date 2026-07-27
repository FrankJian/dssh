import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { isMacOS } from "../platform";
import { invokeCommand } from "../services/tauri";
import { Button } from "../ui/Button";

interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
}

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "uptodate" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; version: string; downloaded: number; total: number | null }
  | { phase: "installing" }
  | { phase: "error"; message: string; attempts?: UpdateEndpointDiagnostic[] };

interface UpdateEndpointDiagnostic {
  url: string;
  error: string | null;
}

/** Optional proxy for update checks, e.g. http://127.0.0.1:7890 or socks5://…. */
const UPDATE_PROXY_KEY = "dssh.update.proxy";

function detectPlatform(): string {
  if (isMacOS) {
    return "macOS";
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) {
    return "Windows";
  }
  if (/Linux/i.test(ua)) {
    return "Linux";
  }
  return "未知";
}

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

export function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ phase: "idle" });
  const [proxy, setProxy] = useState<string>(() => localStorage.getItem(UPDATE_PROXY_KEY) ?? "");

  useEffect(() => {
    localStorage.setItem(UPDATE_PROXY_KEY, proxy);
  }, [proxy]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getName(), getVersion(), getTauriVersion()])
      .then(([name, version, tauriVersion]) => {
        if (!cancelled) {
          setInfo({ name, version, tauriVersion });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfo({ name: "dssh", version: "未知", tauriVersion: "未知" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const platform = detectPlatform();
  const rows: Array<{ label: string; value: string }> = [
    { label: "版本", value: info?.version ?? "…" },
    { label: "Tauri 运行时", value: info?.tauriVersion ?? "…" },
    { label: "运行平台", value: platform },
  ];

  async function handleCopy() {
    const text = [
      `${info?.name ?? "dssh"} ${info?.version ?? ""}`.trim(),
      `Tauri ${info?.tauriVersion ?? ""}`.trim(),
      `平台 ${platform}`,
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  async function handleCheckUpdate() {
    setUpdate({ phase: "checking" });
    const trimmedProxy = proxy.trim();
    try {
      // The same proxy is reused for the download, so an update found through
      // it can also be installed through it.
      const found = await check(trimmedProxy ? { proxy: trimmedProxy } : undefined);
      if (!found) {
        setUpdate({ phase: "uptodate" });
        return;
      }
      setUpdate({ phase: "available", update: found });
    } catch (error) {
      let attempts: UpdateEndpointDiagnostic[] | undefined;
      try {
        attempts = await invokeCommand<UpdateEndpointDiagnostic[]>(
          "app_update_endpoint_diagnostics",
          { proxy: trimmedProxy || null },
        );
      } catch {
        // Keep the updater's own error when diagnostics are unavailable.
      }
      setUpdate({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
        attempts,
      });
    }
  }

  async function handleInstall(found: Update) {
    const version = found.version;
    let downloaded = 0;
    let total: number | null = null;
    setUpdate({ phase: "downloading", version, downloaded, total });
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
        } else if (event.event === "Finished") {
          setUpdate({ phase: "installing" });
          return;
        }
        setUpdate({ phase: "downloading", version, downloaded, total });
      });
      setUpdate({ phase: "installing" });
      // Restart into the freshly installed version.
      await relaunch();
    } catch (error) {
      setUpdate({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const isWorking = update.phase === "checking" || update.phase === "downloading" ||
    update.phase === "installing";

  return (
    <section className="settings-section" aria-label="关于">
      <div className="about-hero">
        <img className="about-hero__logo" src="/icon.png" alt="dssh" width={44} height={44} />
        <div className="about-hero__meta">
          <h3 className="about-hero__name">{(info?.name ?? "dssh").toUpperCase()}</h3>
          <p className="about-hero__tagline">轻量级跨平台 SSH 管理器</p>
        </div>
      </div>

      <dl className="about-info">
        {rows.map((row) => (
          <div className="about-info__row" key={row.label}>
            <dt className="about-info__label">{row.label}</dt>
            <dd className="about-info__value">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="settings-config__actions">
        <Button disabled={isWorking} onClick={handleCheckUpdate} variant="primary">
          {update.phase === "checking" ? "检查中…" : "检查更新"}
        </Button>
        <Button disabled={isWorking} onClick={handleCopy} variant="ghost">
          {copied ? "已复制" : "复制版本信息"}
        </Button>
      </div>

      <label className="settings-field about-proxy">
        <span className="settings-field__label">更新代理（可选）</span>
        <input
          className="settings-number"
          disabled={isWorking}
          onChange={(event) => setProxy(event.currentTarget.value)}
          placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
          spellCheck={false}
          type="text"
          value={proxy}
        />
        <span className="settings-field__hint">
          留空表示直连。若检查更新因网络问题失败，可在此填写代理地址后重试；该地址同时用于下载更新包。
        </span>
      </label>

      {update.phase === "uptodate" ? (
        <div className="about-update about-update--ok">已是最新版本。</div>
      ) : null}

      {update.phase === "available" ? (
        <div className="about-update">
          <div className="about-update__head">
            <span className="about-update__title">发现新版本 {update.update.version}</span>
            <Button onClick={() => void handleInstall(update.update)} variant="primary">
              下载并安装
            </Button>
          </div>
          {update.update.body ? (
            <p className="about-update__notes">{update.update.body}</p>
          ) : null}
        </div>
      ) : null}

      {update.phase === "downloading" ? (
        <div className="about-update">
          <div className="about-update__title">正在下载 {update.version}…</div>
          <div className="about-update__track">
            <div
              className="about-update__bar"
              data-indeterminate={update.total == null}
              style={
                update.total
                  ? { width: `${Math.min(100, Math.round((update.downloaded / update.total) * 100))}%` }
                  : undefined
              }
            />
          </div>
          <div className="about-update__meta">
            {formatSize(update.downloaded)}
            {update.total != null ? ` / ${formatSize(update.total)}` : ""}
          </div>
        </div>
      ) : null}

      {update.phase === "installing" ? (
        <div className="about-update about-update--ok">安装完成，正在重启应用…</div>
      ) : null}

      {update.phase === "error" ? (
        <div className="about-update about-update--error" role="alert">
          <div>检查或安装更新失败：{update.message}</div>
          {update.attempts?.length ? (
            <ul className="about-update__attempts">
              {update.attempts.map((attempt) => (
                <li key={attempt.url}>
                  <code>{attempt.url}</code>
                  <span>{attempt.error ?? "可访问，但更新清单未能通过校验。"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
