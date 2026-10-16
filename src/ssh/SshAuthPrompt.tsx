import { useState, type FormEvent } from "react";
import type { SshAuthPromptEvent } from "../services/sshSessionService";
import { Icon } from "../ui/Icon";

interface SshAuthPromptProps {
  prompt: SshAuthPromptEvent;
  onCancel: () => Promise<void>;
  onSubmit: (responses: string[]) => Promise<void>;
}

/** A transient keyboard-interactive challenge, most commonly an OTP prompt. */
export function SshAuthPrompt({ prompt, onCancel, onSubmit }: SshAuthPromptProps) {
  const [responses, setResponses] = useState(() => prompt.prompts.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(responses);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    setSubmitting(true);
    setError(null);
    try {
      await onCancel();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
      setSubmitting(false);
    }
  }

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section
        aria-describedby="ssh-auth-description"
        aria-labelledby="ssh-auth-title"
        aria-modal="true"
        className="hostkey-dialog ssh-auth-dialog"
        role="dialog"
      >
        <header className="hostkey-dialog__header">
          <Icon name="shield" height="16" width="16" />
          <h2 id="ssh-auth-title">{prompt.name.trim() || "多因子认证"}</h2>
        </header>
        <form onSubmit={handleSubmit}>
          <div className="hostkey-dialog__body">
            <p className="hostkey-dialog__intro" id="ssh-auth-description">
              <strong>{prompt.username}@{prompt.host}:{prompt.port}</strong> 需要额外验证。
            </p>
            {prompt.instructions.trim() ? (
              <p className="ssh-auth-dialog__instructions">{prompt.instructions}</p>
            ) : null}
            {prompt.retryMessage ? (
              <div className="ssh-auth-dialog__error" role="alert">{prompt.retryMessage}</div>
            ) : null}
            <div className="ssh-auth-dialog__fields">
              {prompt.prompts.map((field, index) => (
                <label className="ssh-auth-dialog__field" key={`${field.prompt}-${index}`}>
                  <span>{field.prompt.trim() || `认证信息 ${index + 1}`}</span>
                  <input
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    autoFocus={index === 0}
                    disabled={submitting}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setResponses((current) =>
                        current.map((response, responseIndex) =>
                          responseIndex === index ? value : response,
                        ),
                      );
                    }}
                    spellCheck={false}
                    type={field.echo ? "text" : "password"}
                    value={responses[index]}
                  />
                </label>
              ))}
            </div>
            {error ? <div className="ssh-auth-dialog__error" role="alert">{error}</div> : null}
            <p className="hostkey-dialog__warning">
              本次输入只用于当前 SSH 登录，不会保存到连接配置中。
            </p>
          </div>
          <div className="hostkey-dialog__actions">
            <button
              className="button"
              disabled={submitting}
              onClick={() => void handleCancel()}
              type="button"
            >
              取消连接
            </button>
            <button className="button button--primary" disabled={submitting} type="submit">
              {submitting ? "正在验证…" : "验证并继续"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
