import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import type { CopilotDeviceInfo } from "../models/ai";
import {
  cancelCopilotLogin,
  onCopilotAuthEvent,
  startCopilotLogin,
} from "../services/aiService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface CopilotLoginModalProps {
  proxyUrl: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Phase = "starting" | "waiting" | "error";

export function CopilotLoginModal({ proxyUrl, onClose, onSuccess }: CopilotLoginModalProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [device, setDevice] = useState<CopilotDeviceInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const succeededRef = useRef(false);

  useEffect(() => {
    let active = true;
    const unlistenPromise = onCopilotAuthEvent((event) => {
      if (!active) {
        return;
      }
      if (event.kind === "success") {
        succeededRef.current = true;
        onSuccess();
      } else {
        setPhase("error");
        setMessage(event.message);
      }
    });

    startCopilotLogin(proxyUrl || undefined)
      .then((info) => {
        if (!active) {
          return;
        }
        setDevice(info);
        setPhase("waiting");
        void openUrl(info.verificationUri).catch(() => {
          // Non-fatal: the user can still open the URL manually.
        });
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setPhase("error");
        setMessage(error instanceof Error ? error.message : "启动登录失败。");
      });

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
      // Stop the backend poll unless login already completed.
      if (!succeededRef.current) {
        void cancelCopilotLogin();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopy() {
    if (!device) {
      return;
    }
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the code is still shown for manual entry.
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="copilot-login" aria-label="登录 GitHub Copilot">
        <header className="copilot-login__header">
          <h3>登录 GitHub Copilot</h3>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        {phase === "starting" ? (
          <p className="copilot-login__hint">正在申请设备码…</p>
        ) : null}

        {phase === "waiting" && device ? (
          <>
            <p className="copilot-login__hint">
              请在浏览器中打开下方地址，并输入验证码完成授权。授权成功后本窗口会自动关闭。
            </p>

            <div className="copilot-login__code-row">
              <code className="copilot-login__code">{device.userCode}</code>
              <Button onClick={() => void handleCopy()} variant="ghost">
                {copied ? "已复制" : "复制"}
              </Button>
            </div>

            <div className="copilot-login__url">
              <span>{device.verificationUri}</span>
              <Button onClick={() => void openUrl(device.verificationUri)} variant="ghost">
                打开浏览器
              </Button>
            </div>

            <p className="copilot-login__waiting">
              <Icon className="copilot-login__spin" name="refresh" height="14" width="14" />
              等待授权中…
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <div className="copilot-login__error">{message ?? "登录失败。"}</div>
        ) : null}

        <footer className="copilot-login__footer">
          <Button onClick={onClose} variant="ghost">
            {phase === "error" ? "关闭" : "取消"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
