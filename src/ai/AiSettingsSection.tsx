import { SettingsSwitch } from "../ui/SettingsSwitch";
import { useId, useRef, useState } from "react";
import type { AiConnectionTestResult, AiProvider, AiProviderKind } from "../models/ai";
import { listAiModels, testAiConnection } from "../services/aiService";
import { Button } from "../ui/Button";
import { SelectMenu } from "../ui/SelectMenu";
import { AiModelCatalog, type AiModelCatalogHandle } from "./AiModelCatalog";
import { Icon } from "../ui/Icon";
import { API_PROTOCOLS, createEmptyProvider, ENDPOINT_PRESETS, inferPresetId } from "./aiConfig";
import type { AiConfig } from "./useAiConfig";
import { settingsActionError } from "./aiSettingsValidation";
import type { AssistantDockControls } from "../app/useAssistantDock";
import { AiDockSettings } from "./AiDockSettings";
import { AiRequestHeaders } from "./AiRequestHeaders";
import { AiConnectionDetails } from "./AiConnectionDetails";

export function AiSettingsSection({ aiConfig, assistantDock }: { aiConfig: AiConfig; assistantDock?: AssistantDockControls }) {
  const { providers, activeProviderId, options, setOptions } = aiConfig;
  const serviceHeadingId = useId();
  const assistantHeadingId = useId();
  const [editedProvider, setDraft] = useState<AiProvider | null>(null);
  const draft = editedProvider ?? providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const savedProvider = providers.find((provider) => provider.id === draft?.id);
  const addingService = Boolean(draft && !savedProvider);
  const previousServiceId = useRef<string | null>(null);
  const presetId = draft ? inferPresetId(draft) : "custom";
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [modelPending, setModelPending] = useState(false);
  const modelCatalog = useRef<AiModelCatalogHandle>(null);
  const [modelEditorRevision, setModelEditorRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const [dirty, setDirty] = useState(false);

  function edit(provider: AiProvider | null) {
    if ((dirty || modelPending) && !window.confirm("放弃尚未保存的模型配置？")) return false;
    setDraft(provider ? { ...provider } : null);
    setDiscoveredModels([]); setModelPending(false); setModelEditorRevision((value) => value + 1);
    setDirty(false); setError(null); setNotice(null); setTestResult(null);
    return true;
  }

  function addService() {
    if (edit(createEmptyProvider())) previousServiceId.current = savedProvider?.id ?? null;
  }

  function cancelAddService() {
    const previous = providers.find((provider) => provider.id === previousServiceId.current);
    if (edit(previous ?? null)) previousServiceId.current = null;
  }
  function patch(value: Partial<AiProvider>) {
    setDraft((previous) => {
      const current = previous ?? draft;
      return current ? { ...current, ...value } : null;
    });
    setDirty(true); setNotice(null); setError(null); setTestResult(null);
  }
  function prepareAction(testingConnection = false) {
    setError(null); setNotice(null); setTestResult(null);
    if (!draft) return null;
    try {
      const provider = { ...draft, ...modelCatalog.current?.resolve() };
      const message = settingsActionError(provider, testingConnection);
      if (message) throw new Error(message);
      return provider;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型配置无效。");
      return null;
    }
  }
  async function testConnection() {
    if (busy) return;
    const provider = prepareAction(true);
    if (!provider) return;
    setBusy(true); setTesting(true); setError(null); setNotice(null);
    try {
      const result = await testAiConnection(provider);
      setTestResult(result);
      if (result.success) setNotice(`连接成功 · ${result.model} · ${(result.elapsedMs / 1000).toFixed(2)} 秒`);
      else setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接测试失败，请检查配置。");
    } finally { setBusy(false); setTesting(false); }
  }
  async function save(fetchModels = false) {
    if (busy) return;
    const provider = prepareAction();
    if (!provider) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = await aiConfig.saveProvider(provider);
      setDraft(saved); setDirty(false);
      modelCatalog.current?.reset();
      if (fetchModels) {
        const discovered = await listAiModels(saved.id);
        setDiscoveredModels([...new Set(discovered)]);
        setNotice(discovered.length ? `已获取 ${discovered.length} 个模型，可在“模型 ID”中搜索后逐个添加。` : "未返回模型，请手动添加模型 ID。");
      } else setNotice("模型配置已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存模型配置失败。");
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!draft || !window.confirm(`删除“${draft.label}”及其已保存的 API 密钥？此操作无法撤销。`)) return;
    setBusy(true); setError(null);
    try {
      await aiConfig.removeProvider(draft.id);
      setDraft(null); setDirty(false); setNotice(null); setTestResult(null);
      setDiscoveredModels([]); setModelPending(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败。"); }
    finally { setBusy(false); }
  }

  return (
    <section className="settings-section ai-settings" aria-label="AI 设置">
      <header className="settings-section__head ai-settings__heading">
        <h3>模型服务</h3>
        <Button disabled={busy || addingService || !aiConfig.isReady} onClick={addService} variant="secondary">
          <Icon name="plus" height="16" width="16" />添加服务
        </Button>
      </header>
      {aiConfig.error ? <div className="ai-provider__error" role="alert">{aiConfig.error} <Button onClick={aiConfig.reload} variant="ghost">重试</Button></div> : null}
      {!aiConfig.isReady ? (!aiConfig.error && <p className="ai-settings__empty" role="status">正在加载模型配置…</p>) : (
        <div className={`ai-settings__workspace${providers.length ? " ai-settings__workspace--has-services" : ""}`}>
          {providers.length ? <nav className="ai-settings__sidebar" aria-label="模型服务列表">
            {providers.map((provider) => (
              <button type="button" key={provider.id} disabled={busy}
                aria-pressed={draft?.id === provider.id}
                className={`ai-settings__provider${draft?.id === provider.id ? " is-selected" : ""}`}
                onClick={() => { if (draft?.id !== provider.id) edit(provider); }}>
                <Icon name="server" height="16" width="16" />
                <span title={provider.label}>{provider.label}</span>
                <small>{provider.id === activeProviderId ? "当前使用 · " : ""}{provider.models.length} 个模型</small>
              </button>
            ))}
          </nav> : null}
          <div className="ai-settings__editor">
            {draft ? (
              <fieldset className="ai-settings__form" aria-labelledby={serviceHeadingId} disabled={busy}>
                <h4 id={serviceHeadingId} className="ai-settings__service-name ai-settings__field-wide">{savedProvider?.label ?? "新建服务"}</h4>
                <div className={presetId === "custom" ? "field ai-settings__field-wide" : "field"}>
                  <span>厂商预设</span>
                  <SelectMenu ariaLabel="厂商预设" searchable searchPlaceholder="搜索厂商…" value={presetId}
                    options={[{ value: "custom", label: "自定义 API / 中转网关" }, ...ENDPOINT_PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
                    onChange={(id) => {
                      const preset = ENDPOINT_PRESETS.find((p) => p.id === id);
                      if (preset) {
                        patch({ presetId: preset.id, label: preset.label, baseUrl: preset.baseUrl, kind: preset.kind, apiKey: "", hasApiKey: false, extraHeaders: [], model: "", models: [] });
                        setDiscoveredModels([]); setModelPending(false); setModelEditorRevision((value) => value + 1);
                      } else {
                        patch({ presetId: "custom", label: "", baseUrl: "" });
                      }
                    }} />
                </div>
                {presetId === "custom" ? <>
                <label className="field">显示名称
                  <input value={draft.label} onChange={(e) => patch({ label: e.currentTarget.value })} />
                </label>
                <label className="field">API 协议
                  <select className="settings-select" value={draft.kind} onChange={(e) => patch({ kind: e.currentTarget.value as AiProviderKind })}>
                    {API_PROTOCOLS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <label className="field">API 地址
                  <input autoComplete="off" title="支持基础地址和完整接口地址，保留网关路径" placeholder="https://gateway.example.com/v1/" value={draft.baseUrl}
                    onChange={(e) => patch({ baseUrl: e.currentTarget.value, presetId: "custom" })} />
                </label>
                </> : null}
                <div className="field ai-settings__key">
                  <div className="ai-settings__key-label">
                    <label htmlFor={`${serviceHeadingId}-key`}>API 密钥</label>
                    {draft.hasApiKey ? <Button onClick={() => patch({ apiKey: "", hasApiKey: false })} variant="ghost" title="保存配置后清除已保存的密钥">清除密钥</Button> : null}
                  </div>
                  <input id={`${serviceHeadingId}-key`} autoComplete="new-password" type="password" value={draft.apiKey ?? ""}
                    placeholder={draft.hasApiKey ? "已保存，留空保持现有密钥" : "输入 API Key（本地服务可留空）"}
                    onChange={(e) => patch({ apiKey: e.currentTarget.value || (draft.hasApiKey ? undefined : "") })} />
                </div>
                <AiModelCatalog ref={modelCatalog} key={`${draft.id}:${modelEditorRevision}`} models={draft.models} defaultModel={draft.model}
                  discovered={discoveredModels} onPendingChange={setModelPending}
                  onDiscover={() => void save(true)} canDiscover={Boolean(draft.label.trim() && draft.baseUrl.trim())}
                  onChange={(models, model) => patch({ models, model })} />
                <details>
                  <summary>高级选项</summary>
                  <AiRequestHeaders headers={draft.extraHeaders ?? []} onChange={(extraHeaders) => patch({ extraHeaders })} />
                  {presetId === "custom" ? <label className="field">代理（可选）
                    <input autoComplete="off" placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                      value={draft.proxyUrl} onChange={(e) => patch({ proxyUrl: e.currentTarget.value })} />
                  </label> : null}
                </details>
                <div className="ai-settings__actions">
                  <Button onClick={() => void save()} variant="primary">{busy && !testing ? "处理中…" : "保存配置"}</Button>
                  <Button onClick={() => void testConnection()} variant="secondary">{testing ? "测试中…" : "测试连接"}</Button>
                  {addingService ? <Button onClick={cancelAddService} variant="ghost">取消</Button> : null}
                  {savedProvider ? <Button className="ai-settings__remove" onClick={() => void remove()} variant="ghost">删除服务</Button> : null}
                  <div className="ai-settings__feedback" aria-live="polite" aria-atomic="true">
                    {error ? <div className="ai-provider__error" role="alert">{error}</div> : null}
                    {testing ? <span className="settings-field__hint" role="status">正在测试默认模型连接，最长等待 30 秒…</span> : null}
                    {notice ? <span className="settings-field__hint" role="status">{notice}</span> : null}
                    {testResult ? <AiConnectionDetails result={testResult} /> : null}
                  </div>
                </div>
                {dirty ? <span className="settings-field__hint">有未保存的修改</span> : null}
              </fieldset>
            ) : <p className="ai-settings__empty"><Icon name="server" height="18" width="18" />尚未添加模型服务</p>}
            {!draft && error ? <div className="ai-provider__error" role="alert">{error}</div> : null}
          </div>
        </div>
      )}
      <section className="ai-settings__assistant" aria-labelledby={assistantHeadingId}>
        <details className="ai-settings__behavior">
          <summary><span id={assistantHeadingId}>助手设置</span><Icon name="chevron-right" height="16" width="16" /></summary>
          {assistantDock ? <AiDockSettings dock={assistantDock} /> : null}
          <div className="ai-settings__behavior-fields">
            <label className="settings-control-row ai-settings__approval">
              <span>执行服务器命令前需要我确认（推荐）</span>
              <SettingsSwitch
                checked={options.requireApproval}
                onChange={(event) => setOptions({ requireApproval: event.currentTarget.checked })}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field__label">采样温度</span>
              <input
                className="settings-select"
                max={2}
                min={0}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setOptions({ temperature: value === "" ? null : Number(value) });
                }}
                placeholder="模型默认值"
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
          </div>
        </details>
      </section>
    </section>
  );
}
