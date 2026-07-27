import { useState } from "react";
import type { AiProvider } from "../models/ai";
import { listAiModels, logoutCopilot } from "../services/aiService";
import { Button } from "../ui/Button";
import { ComboBox } from "../ui/ComboBox";
import { Icon } from "../ui/Icon";
import { createEmptyProvider, ENDPOINT_PRESETS } from "./aiConfig";
import { CopilotLoginModal } from "./CopilotLoginModal";
import type { AiConfig } from "./useAiConfig";

const ENDPOINT_OPTIONS = ENDPOINT_PRESETS.map((preset) => ({
  value: preset.baseUrl,
  label: preset.label,
}));

interface AiSettingsSectionProps {
  aiConfig: AiConfig;
}

export function AiSettingsSection({ aiConfig }: AiSettingsSectionProps) {
  const {
    activeProviderId,
    addProvider,
    copilotLoggedIn,
    options,
    providers,
    refreshCopilotStatus,
    removeProvider,
    setActiveProviderId,
    setOptions,
    updateProvider,
  } = aiConfig;

  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string | null>>({});
  const [loginOpen, setLoginOpen] = useState(false);

  async function handleFetchModels(provider: AiProvider) {
    const id = provider.id;
    setFetchingId(id);
    setErrorById((prev) => ({ ...prev, [id]: null }));
    try {
      const models = await listAiModels({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        proxyUrl: provider.proxyUrl,
        kind: provider.kind,
      });
      // Persist the fetched list on the provider so the chat page can offer
      // model switching. A successful fetch with 0 models leaves the list empty.
      updateProvider(id, { models });
      if (models.length === 0) {
        setErrorById((prev) => ({ ...prev, [id]: "未获取到模型，请手动填写模型名称。" }));
      }
    } catch (error) {
      setErrorById((prev) => ({
        ...prev,
        [id]: error instanceof Error ? error.message : "获取模型列表失败。",
      }));
    } finally {
      setFetchingId(null);
    }
  }

  async function handleCopilotLogout() {
    try {
      await logoutCopilot();
    } finally {
      await refreshCopilotStatus();
    }
  }

  return (
    <section className="settings-section ai-settings" aria-label="AI 模型后端">
      <div className="settings-section__head">
        <h3>模型后端</h3>
        <p>配置兼容 OpenAI 接口的模型服务（API 地址、密钥、模型），供 AI 助手使用。</p>
      </div>

      {providers.length === 0 ? (
        <div className="ai-settings__empty">尚未添加任何模型后端。</div>
      ) : (
        <div className="ai-settings__list">
          {providers.map((provider) => {
            const isActive = provider.id === activeProviderId;
            const models = provider.models ?? [];
            const error = errorById[provider.id];

            if (provider.kind === "copilot") {
              return (
                <div
                  className={`ai-provider ${isActive ? "is-active" : ""}`.trim()}
                  key={provider.id}
                >
                  <div className="ai-provider__top">
                    <div className="ai-provider__name">
                      <Icon name="bot" height="16" width="16" />
                      <span>{provider.label}</span>
                      <span
                        className={`ai-provider__status ${
                          copilotLoggedIn ? "is-on" : ""
                        }`.trim()}
                      >
                        {copilotLoggedIn ? "已登录" : "未登录"}
                      </span>
                    </div>
                    <div className="ai-provider__top-actions">
                      {isActive ? (
                        <span className="ai-provider__badge">当前使用</span>
                      ) : (
                        <Button
                          onClick={() => setActiveProviderId(provider.id)}
                          variant="ghost"
                        >
                          设为当前
                        </Button>
                      )}
                    </div>
                  </div>

                  <p className="settings-field__hint">
                    通过 GitHub 设备登录授权，使用你的 GitHub Copilot 订阅。凭据保存在本地，不含 API 密钥。
                  </p>

                  <label className="field">
                    代理（可选，支持 http/https/socks5）
                    <input
                      autoComplete="off"
                      onChange={(event) =>
                        updateProvider(provider.id, { proxyUrl: event.currentTarget.value })
                      }
                      placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                      value={provider.proxyUrl}
                    />
                  </label>

                  <div className="ai-provider__actions">
                    {copilotLoggedIn ? (
                      <Button onClick={() => void handleCopilotLogout()} variant="ghost">
                        退出登录
                      </Button>
                    ) : (
                      <Button onClick={() => setLoginOpen(true)} variant="ghost">
                        登录 GitHub Copilot
                      </Button>
                    )}
                  </div>

                  <label className="field">
                    模型
                    <div className="ai-provider__model-row">
                      <ComboBox
                        ariaLabel="模型"
                        onChange={(next) => updateProvider(provider.id, { model: next })}
                        options={models.map((model) => ({ value: model }))}
                        placeholder="gpt-4o"
                        value={provider.model}
                      />
                      <Button
                        disabled={fetchingId === provider.id || !copilotLoggedIn}
                        onClick={() => handleFetchModels(provider)}
                        variant="ghost"
                      >
                        {fetchingId === provider.id ? "获取中…" : "获取模型"}
                      </Button>
                    </div>
                  </label>

                  {error ? <div className="ai-provider__error">{error}</div> : null}
                </div>
              );
            }

            return (
              <div
                className={`ai-provider ${isActive ? "is-active" : ""}`.trim()}
                key={provider.id}
              >
                <div className="ai-provider__top">
                  <input
                    aria-label="后端名称"
                    className="ai-provider__label-input"
                    onChange={(event) =>
                      updateProvider(provider.id, { label: event.currentTarget.value })
                    }
                    placeholder="后端名称"
                    value={provider.label}
                  />
                  <div className="ai-provider__top-actions">
                    {isActive ? (
                      <span className="ai-provider__badge">当前使用</span>
                    ) : (
                      <Button onClick={() => setActiveProviderId(provider.id)} variant="ghost">
                        设为当前
                      </Button>
                    )}
                    <button
                      aria-label="删除后端"
                      className="icon-button"
                      onClick={() => removeProvider(provider.id)}
                      type="button"
                    >
                      <Icon name="trash" height="16" width="16" />
                    </button>
                  </div>
                </div>

                <label className="field">
                  API 地址
                  <ComboBox
                    ariaLabel="API 地址"
                    onChange={(next) => updateProvider(provider.id, { baseUrl: next })}
                    options={ENDPOINT_OPTIONS}
                    placeholder="https://api.openai.com/v1/"
                    value={provider.baseUrl}
                  />
                </label>

                <label className="field">
                  API 密钥
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      updateProvider(provider.id, { apiKey: event.currentTarget.value })
                    }
                    placeholder="sk-..."
                    type="password"
                    value={provider.apiKey}
                  />
                </label>

                <label className="field">
                  代理（可选，支持 http/https/socks5）
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      updateProvider(provider.id, { proxyUrl: event.currentTarget.value })
                    }
                    placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                    value={provider.proxyUrl}
                  />
                </label>

                <label className="field">
                  模型
                  <div className="ai-provider__model-row">
                    <ComboBox
                      ariaLabel="模型"
                      onChange={(next) => updateProvider(provider.id, { model: next })}
                      options={models.map((model) => ({ value: model }))}
                      placeholder="gpt-4o-mini"
                      value={provider.model}
                    />
                    <Button
                      disabled={fetchingId === provider.id || !provider.baseUrl.trim()}
                      onClick={() => handleFetchModels(provider)}
                      variant="ghost"
                    >
                      {fetchingId === provider.id ? "获取中…" : "获取模型"}
                    </Button>
                  </div>
                </label>

                {error ? <div className="ai-provider__error">{error}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <Button onClick={() => addProvider(createEmptyProvider())} variant="ghost">
          <Icon name="plus" height="16" width="16" />
          添加模型后端
        </Button>
      </div>

      <div className="settings-section__head">
        <h3>行为</h3>
        <p>控制 AI 助手执行 SSH 操作时的安全与推理设置。</p>
      </div>

      <label className="checkbox-field">
        <input
          checked={options.requireApproval}
          onChange={(event) => setOptions({ requireApproval: event.currentTarget.checked })}
          type="checkbox"
        />
        执行服务器命令前需要我确认（推荐）
      </label>

      <label className="settings-field">
        <span className="settings-field__label">采样温度（留空使用模型默认值）</span>
        <input
          className="settings-select"
          max={2}
          min={0}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setOptions({ temperature: value === "" ? null : Number(value) });
          }}
          placeholder="默认"
          step={0.1}
          type="number"
          value={options.temperature ?? ""}
        />
      </label>

      <label className="settings-field">
        <span className="settings-field__label">单轮最大工具步数</span>
        <input
          className="settings-select"
          max={40}
          min={1}
          onChange={(event) =>
            setOptions({ maxSteps: Math.min(40, Math.max(1, Number(event.currentTarget.value) || 1)) })
          }
          type="number"
          value={options.maxSteps}
        />
      </label>

      <div className="settings-section__head">
        <h3>历史上下文压缩</h3>
        <p>
          控制多轮对话的上下文长度。对话较短时原样发送；超过阈值后，较早的对话会自动压缩成摘要，
          最近的对话保持原文，以在不超出模型上下文窗口的前提下保留关键信息。
        </p>
      </div>

      <label className="settings-field">
        <span className="settings-field__label">历史压缩触发阈值（historyMaxChars）</span>
        <input
          className="settings-select"
          max={200000}
          min={2000}
          step={1000}
          onChange={(event) =>
            setOptions({
              historyMaxChars: Math.min(200000, Math.max(2000, Number(event.currentTarget.value) || 2000)),
            })
          }
          type="number"
          value={options.historyMaxChars}
        />
        <span className="settings-field__hint">
          对话历史累计字符数超过该值后，才开始压缩更早的内容；未超过时完全不压缩。默认 16000。
        </span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">保留原文的近期长度（historyRecentChars）</span>
        <input
          className="settings-select"
          max={200000}
          min={1000}
          step={1000}
          onChange={(event) =>
            setOptions({
              historyRecentChars: Math.max(1000, Number(event.currentTarget.value) || 1000),
            })
          }
          type="number"
          value={options.historyRecentChars}
        />
        <span className="settings-field__hint">
          最近多少字符的对话保持原文、不做压缩，保证近期上下文精确。应小于触发阈值，否则不会发生压缩。默认 8000。
        </span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">摘要分块大小（historyChunkChars）</span>
        <input
          className="settings-select"
          max={20000}
          min={500}
          step={500}
          onChange={(event) =>
            setOptions({
              historyChunkChars: Math.min(20000, Math.max(500, Number(event.currentTarget.value) || 500)),
            })
          }
          type="number"
          value={options.historyChunkChars}
        />
        <span className="settings-field__hint">
          压缩更早对话时每块的字符数。块越小摘要越细致但调用次数越多；分块摘要会按内容缓存，避免重复压缩。默认 3000。
        </span>
      </label>

      {loginOpen ? (
        <CopilotLoginModal
          proxyUrl={providers.find((provider) => provider.kind === "copilot")?.proxyUrl ?? ""}
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            void refreshCopilotStatus();
          }}
        />
      ) : null}
    </section>
  );
}
