import { useRef, useState } from "react";
import type { AiProvider, AiProviderKind } from "../models/ai";
import { listAiModels, testAiConnection } from "../services/aiService";
import { Button } from "../ui/Button";
import { SelectMenu } from "../ui/SelectMenu";
import { AiModelCatalog, type AiModelCatalogHandle } from "./AiModelCatalog";
import { Icon } from "../ui/Icon";
import { API_PROTOCOLS, createEmptyProvider, ENDPOINT_PRESETS, inferPresetId } from "./aiConfig";
import type { AiConfig } from "./useAiConfig";
import { settingsActionError } from "./aiSettingsValidation";

export function AiSettingsSection({ aiConfig }: { aiConfig: AiConfig }) {
  const { providers, activeProviderId, options, setOptions } = aiConfig;
  const [draft, setDraft] = useState<AiProvider | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [modelPending, setModelPending] = useState(false);
  const modelCatalog = useRef<AiModelCatalogHandle>(null);
  const [modelEditorRevision, setModelEditorRevision] = useState(0);
  const [presetId, setPresetId] = useState("custom");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function edit(provider: AiProvider) {
    if ((dirty || modelPending) && !window.confirm("放弃尚未保存的模型配置？")) return;
    setDraft({ ...provider });
    setDiscoveredModels([]); setModelPending(false); setModelEditorRevision((value) => value + 1);
    setPresetId(inferPresetId(provider));
    setDirty(false); setError(null); setNotice(null);
  }
  function patch(value: Partial<AiProvider>) {
    setDraft((previous) => previous ? { ...previous, ...value } : null);
    setDirty(true); setNotice(null); setError(null);
  }
  function prepareAction(testingConnection = false) {
    setError(null); setNotice(null);
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
      setNotice(`连接成功 · ${result.model} · ${(result.elapsedMs / 1000).toFixed(2)} 秒`);
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
      setDraft(null); setDirty(false); setNotice(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败。"); }
    finally { setBusy(false); }
  }

  return (
    <section className="settings-section ai-settings" aria-label="AI 模型服务">
      <div className="settings-section__head">
        <h3>模型服务</h3>
        <p>预置厂商只需填写 API Key；自定义 API 可配置地址与协议。在对话输入区可切换模型。</p>
      </div>
      {aiConfig.error ? <div className="ai-provider__error" role="alert">{aiConfig.error} <Button onClick={aiConfig.reload} variant="ghost">重试</Button></div> : null}
      {!aiConfig.isReady ? <p className="settings-field__hint">正在加载模型配置…</p> : (
        <div className="ai-settings__workspace">
          <nav className="ai-settings__sidebar" aria-label="模型服务列表">
            <Button disabled={busy} onClick={() => edit(createEmptyProvider())} variant="ghost">
              <Icon name="plus" height="16" width="16" />添加服务
            </Button>
            {providers.map((provider) => (
              <button type="button" key={provider.id} disabled={busy}
                className={`ai-settings__provider${draft?.id === provider.id ? " is-selected" : ""}`}
                onClick={() => edit(provider)}>
                <span>{provider.label}</span>
                <small>{provider.id === activeProviderId ? "当前使用 · " : ""}{provider.models.length} 个模型</small>
              </button>
            ))}
            {!providers.length ? <p className="settings-field__hint">添加首个模型服务以开始使用。</p> : null}
          </nav>
          <div className="ai-settings__editor">
            {draft ? (
              <fieldset className="ai-settings__form" disabled={busy}>
                <div className="field ai-settings__field-wide">
                  <span>厂商预设</span>
                  <SelectMenu ariaLabel="厂商预设" searchable searchPlaceholder="搜索厂商…" value={presetId}
                    options={[{ value: "custom", label: "自定义 API / 中转网关" }, ...ENDPOINT_PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
                    onChange={(id) => {
                      setPresetId(id);
                      const preset = ENDPOINT_PRESETS.find((p) => p.id === id);
                      if (preset) {
                        patch({ presetId: preset.id, label: preset.label, baseUrl: preset.baseUrl, kind: preset.kind, apiKey: "", hasApiKey: false, model: "", models: [] });
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
                <label className="field ai-settings__field-wide">API 地址
                  <input autoComplete="off" placeholder="https://gateway.example.com/v1/" value={draft.baseUrl}
                    onChange={(e) => { patch({ baseUrl: e.currentTarget.value, presetId: "custom" }); setPresetId("custom"); }} />
                  <span className="settings-field__hint">填写基础地址，也可粘贴完整的协议接口地址；网关路径会保留。</span>
                </label>
                </> : null}
                <label className="field ai-settings__field-wide">API 密钥
                  <input autoComplete="new-password" type="password" value={draft.apiKey ?? ""}
                    placeholder={draft.hasApiKey ? "已保存，留空保持现有密钥" : "输入 API Key（本地服务可留空）"}
                    onChange={(e) => patch({ apiKey: e.currentTarget.value || (draft.hasApiKey ? undefined : "") })} />
                  <span className="settings-field__hint">保存后仅由本机后端读取，不回显密钥。</span>
                </label>
                {draft.hasApiKey ? <Button onClick={() => patch({ apiKey: "", hasApiKey: false })} variant="ghost">清除已保存密钥（保存后生效）</Button> : null}
                <AiModelCatalog ref={modelCatalog} key={`${draft.id}:${modelEditorRevision}`} models={draft.models} defaultModel={draft.model}
                  discovered={discoveredModels} onPendingChange={setModelPending}
                  onDiscover={() => void save(true)} canDiscover={Boolean(draft.label.trim() && draft.baseUrl.trim())}
                  onChange={(models, model) => patch({ models, model })} />
                {presetId === "custom" ? <details>
                  <summary>连接选项</summary>
                  <label className="field">代理（可选）
                    <input autoComplete="off" placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
                      value={draft.proxyUrl} onChange={(e) => patch({ proxyUrl: e.currentTarget.value })} />
                  </label>
                </details> : null}
                <div className="ai-settings__actions">
                  <Button onClick={() => void save()}>{busy && !testing ? "处理中…" : "保存配置"}</Button>
                  <Button onClick={() => void testConnection()}>{testing ? "测试中…" : "测试连接"}</Button>
                  {providers.some((p) => p.id === draft.id) ? <Button onClick={() => void remove()} variant="ghost">删除服务</Button> : null}
                  <div className="ai-settings__feedback" aria-live="polite" aria-atomic="true">
                    {error ? <div className="ai-provider__error" role="alert">{error}</div> : null}
                    {testing ? <span className="settings-field__hint" role="status">正在测试默认模型连接，最长等待 30 秒…</span> : null}
                    {notice ? <span className="settings-field__hint" role="status">{notice}</span> : null}
                  </div>
                </div>
                {dirty ? <span className="settings-field__hint">有未保存的修改</span> : null}
              </fieldset>
            ) : <div className="ai-settings__empty">从左侧选择服务，或添加厂商预设 / 自定义 API。</div>}
            {!draft && error ? <div className="ai-provider__error" role="alert">{error}</div> : null}
          </div>
        </div>
      )}
      <details className="ai-settings__behavior">
        <summary>助手行为</summary>
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

      </details>
    </section>
  );
}
