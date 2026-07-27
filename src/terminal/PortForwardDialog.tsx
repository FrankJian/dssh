import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ForwardKind, PortForward } from "../models";
import {
  listPortForwards,
  startPortForward,
  stopPortForward,
} from "../services/forwardingService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface PortForwardDialogProps {
  sessionId: string;
  profileId: string;
  defaultRemoteHost: string;
  onClose: () => void;
}

interface FormState {
  kind: ForwardKind;
  localHost: string;
  localPort: string;
  remoteHost: string;
  remotePort: string;
  description: string;
}

const kindTabs: Array<{ id: ForwardKind; label: string }> = [
  { id: "local", label: "本地" },
  { id: "remote", label: "远程" },
  { id: "dynamic", label: "Dynamic" },
];

const kindHints: Record<ForwardKind, string> = {
  local: "本地端口的连接将通过 SSH 转发到远端主机。",
  remote: "远端端口的连接将通过 SSH 转发回本地主机。",
  dynamic: "在本地开启 SOCKS5 代理，动态转发所有流量。",
};

function createInitialForm(defaultRemoteHost: string): FormState {
  return {
    kind: "local",
    localHost: "127.0.0.1",
    localPort: "8000",
    remoteHost: defaultRemoteHost || "127.0.0.1",
    remotePort: "80",
    description: "",
  };
}

function parsePort(value: string): number | null {
  const port = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return port;
}

function describeForward(forward: PortForward): string {
  const local = `${forward.localHost}:${forward.localPort}`;
  const remote = `${forward.remoteHost}:${forward.remotePort}`;
  if (forward.kind === "dynamic") {
    return `SOCKS5 ${local}`;
  }
  if (forward.kind === "remote") {
    return `${remote} → ${local}`;
  }
  return `${local} → ${remote}`;
}

const kindLabels: Record<ForwardKind, string> = {
  local: "本地",
  remote: "远程",
  dynamic: "Dynamic",
};

export function PortForwardDialog({
  defaultRemoteHost,
  onClose,
  profileId,
  sessionId,
}: PortForwardDialogProps) {
  const [form, setForm] = useState<FormState>(() => createInitialForm(defaultRemoteHost));
  const [forwards, setForwards] = useState<PortForward[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listPortForwards(sessionId);
      setForwards(list);
    } catch {
      // Listing failures are non-fatal; keep whatever we already have.
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function updateForm<Field extends keyof FormState>(field: Field, value: FormState[Field]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const localPort = parsePort(form.localPort);
    if (!form.localHost.trim()) {
      setError("请输入本地地址。");
      return;
    }
    if (localPort === null) {
      setError("请输入有效的本地端口 (1-65535)。");
      return;
    }

    let remoteHost = form.remoteHost.trim();
    let remotePort = 0;
    if (form.kind !== "dynamic") {
      const parsedRemote = parsePort(form.remotePort);
      if (!remoteHost) {
        setError("请输入远端地址。");
        return;
      }
      if (parsedRemote === null) {
        setError("请输入有效的远端端口 (1-65535)。");
        return;
      }
      remotePort = parsedRemote;
    } else {
      remoteHost = "";
    }

    setIsSubmitting(true);
    try {
      await startPortForward({
        sessionId,
        profileId,
        kind: form.kind,
        localHost: form.localHost.trim(),
        localPort,
        remoteHost,
        remotePort,
        description: form.description.trim() || null,
      });
      setForm((current) => ({ ...createInitialForm(defaultRemoteHost), kind: current.kind }));
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建端口转发失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleStop(forwardId: string) {
    try {
      await stopPortForward(forwardId);
      await refresh();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "关闭端口转发失败。");
    }
  }

  const isDynamic = form.kind === "dynamic";
  const arrow = form.kind === "remote" ? "←" : "→";

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="port-forward" aria-label="端口转发">
        <header className="profile-editor__topbar">
          <h2>端口转发</h2>
          <button
            aria-label="关闭端口转发"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" height="16" width="16" />
          </button>
        </header>

        <div className="port-forward__body">
          <section className="port-forward__list" aria-label="活动的端口转发">
            {forwards.length === 0 ? (
              <p className="port-forward__empty">暂无端口转发。</p>
            ) : (
              forwards.map((forward) => (
                <div className="port-forward__item" key={forward.id}>
                  <span className="port-forward__badge">{kindLabels[forward.kind]}</span>
                  <div className="port-forward__item-main">
                    <span className="port-forward__item-route">{describeForward(forward)}</span>
                    {forward.description ? (
                      <span className="port-forward__item-desc">{forward.description}</span>
                    ) : null}
                  </div>
                  <button
                    aria-label="关闭此端口转发"
                    className="icon-button"
                    onClick={() => handleStop(forward.id)}
                    type="button"
                  >
                    <Icon name="close" height="16" width="16" />
                  </button>
                </div>
              ))
            )}
          </section>

          <form className="port-forward__form" onSubmit={handleSubmit}>
            <span className="port-forward__form-title">添加端口转发</span>

            {error ? (
              <div className="form-errors" role="alert">
                <p>{error}</p>
              </div>
            ) : null}

            <div className="port-forward__row">
              <input
                aria-label="本地地址"
                className="port-forward__host"
                onChange={(event) => updateForm("localHost", event.currentTarget.value)}
                placeholder="127.0.0.1"
                value={form.localHost}
              />
              <span className="port-forward__colon">:</span>
              <input
                aria-label="本地端口"
                className="port-forward__port"
                inputMode="numeric"
                onChange={(event) => updateForm("localPort", event.currentTarget.value)}
                placeholder="8000"
                value={form.localPort}
              />
              {isDynamic ? null : (
                <>
                  <span className="port-forward__arrow" aria-hidden="true">
                    {arrow}
                  </span>
                  <input
                    aria-label="远端地址"
                    className="port-forward__host"
                    onChange={(event) => updateForm("remoteHost", event.currentTarget.value)}
                    placeholder="127.0.0.1"
                    value={form.remoteHost}
                  />
                  <span className="port-forward__colon">:</span>
                  <input
                    aria-label="远端端口"
                    className="port-forward__port"
                    inputMode="numeric"
                    onChange={(event) => updateForm("remotePort", event.currentTarget.value)}
                    placeholder="80"
                    value={form.remotePort}
                  />
                </>
              )}
            </div>

            <input
              aria-label="描述"
              className="port-forward__description"
              onChange={(event) => updateForm("description", event.currentTarget.value)}
              placeholder="Description"
              value={form.description}
            />

            <div className="port-forward__footer">
              <div className="pf-tabs" role="tablist" aria-label="转发类型">
                {kindTabs.map((tab) => (
                  <button
                    aria-selected={form.kind === tab.id}
                    className={`pf-tab ${form.kind === tab.id ? "is-active" : ""}`.trim()}
                    key={tab.id}
                    onClick={() => updateForm("kind", tab.id)}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <Button
                className="port-forward__submit"
                disabled={isSubmitting}
                type="submit"
                variant="primary"
              >
                <Icon name="forward" height="15" width="15" />
                <span>转发端口</span>
              </Button>
            </div>

            <p className="port-forward__hint">{kindHints[form.kind]}</p>
          </form>
        </div>
      </section>
    </div>
  );
}
