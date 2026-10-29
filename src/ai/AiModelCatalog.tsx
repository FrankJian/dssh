import { useEffect, useState } from "react";
import type { AiModelConfig, AiReasoningLevel } from "../models/ai";
import { AiReasoningLevels } from "./AiReasoningLevels";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { ComboBox } from "../ui/ComboBox";
import { DEFAULT_MODEL_CONTEXT_WINDOW, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, MIN_MODEL_CONTEXT_WINDOW, MAX_MODEL_CONTEXT_WINDOW, parseTokenCapacity, formatTokenCapacity, defaultReasoningLevels } from "./aiConfig";

interface AiModelCatalogProps {
  models: AiModelConfig[];
  defaultModel: string;
  discovered: string[];
  onChange: (models: AiModelConfig[], defaultModel: string) => void;
  onDiscover: () => void;
  canDiscover: boolean;
  onPendingChange: (pending: boolean) => void;
}

export function AiModelCatalog({ models, defaultModel, discovered, onChange, onPendingChange, onDiscover, canDiscover }: AiModelCatalogProps) {
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [contextWindow, setContextWindow] = useState(formatTokenCapacity(DEFAULT_MODEL_CONTEXT_WINDOW));
  const [maxOutputTokens, setMaxOutputTokens] = useState(formatTokenCapacity(DEFAULT_MODEL_MAX_OUTPUT_TOKENS));
  const [imageInput, setImageInput] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<AiModelConfig["reasoningEffort"]>(null);
  const [reasoningLevels, setReasoningLevels] = useState<AiReasoningLevel[]>(defaultReasoningLevels);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = Boolean(editingId || id || displayName || contextWindow !== formatTokenCapacity(DEFAULT_MODEL_CONTEXT_WINDOW) || maxOutputTokens !== formatTokenCapacity(DEFAULT_MODEL_MAX_OUTPUT_TOKENS) || imageInput || reasoningEffort);

  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);

  function reset() {
    setId(""); setDisplayName(""); setContextWindow(formatTokenCapacity(DEFAULT_MODEL_CONTEXT_WINDOW));
    setMaxOutputTokens(formatTokenCapacity(DEFAULT_MODEL_MAX_OUTPUT_TOKENS)); setImageInput(false); setReasoningEffort(null); setReasoningLevels(defaultReasoningLevels());
    setEditingId(null); setError(null); setExpanded(false);
  }

  function commit() {
    const modelId = id.trim();
    const capacity = contextWindow.trim() ? parseTokenCapacity(contextWindow) : DEFAULT_MODEL_CONTEXT_WINDOW;
    if (!modelId) { setError("请填写模型 ID。"); return; }
    if (models.some((model) => model.id === modelId && model.id !== editingId)) {
      setError("此模型 ID 已添加，可在列表中编辑。"); return;
    }
    if (!Number.isInteger(capacity) || capacity < MIN_MODEL_CONTEXT_WINDOW || capacity > MAX_MODEL_CONTEXT_WINDOW) {
      setError("上下文窗口须为 4096 到 10000000 之间的整数。"); return;
    }
    const maxOutput = maxOutputTokens.trim() ? parseTokenCapacity(maxOutputTokens) : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
    if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput >= capacity) {
      setError("最大输出 token 数须小于上下文窗口。"); return;
    }
    const model: AiModelConfig = {
      id: modelId, displayName: displayName.trim() || modelId, contextWindow: capacity,
      maxOutputTokens: maxOutput, inputTypes: imageInput ? ["text", "image"] : ["text"],
      reasoningEffort: reasoningEffort ? reasoningLevels.find((row) => row.level === reasoningEffort)?.level ?? reasoningLevels[0].level : null,
      reasoningLevels: reasoningEffort ? reasoningLevels : [],
    };
    const next = editingId ? models.map((item) => item.id === editingId ? model : item) : [...models, model];
    onChange(next, !defaultModel || defaultModel === editingId ? modelId : defaultModel);
    reset();
  }

  return (
    <section className="ai-model-catalog" aria-label="模型目录">
      <div className="ai-model-catalog__heading">
        <span>模型目录</span>
        <Button variant="ghost" disabled={!canDiscover} onClick={onDiscover}>获取可用模型</Button>
      </div>
      {models.length ? (
        <ul className="ai-model-catalog__list">
          {models.map((model) => (
            <li className="ai-model-catalog__item" key={model.id}>
              <div className="ai-model-catalog__identity">
                <strong title={model.displayName}>{model.displayName}</strong>
                <span title={model.id}>{model.id}</span>
              </div>
              <span className="ai-model-catalog__capacity" title="上下文窗口 / 最大输出 tokens">{formatTokenCapacity(model.contextWindow)} / {formatTokenCapacity(model.maxOutputTokens)}</span>
              <div className="ai-model-catalog__actions">
                {model.id === defaultModel ? <span className="settings-field__hint">默认</span> : (
                  <Button variant="ghost" onClick={() => onChange(models, model.id)} aria-label={`将 ${model.displayName} 设为默认`}>设为默认</Button>
                )}
                <Button variant="ghost" aria-label={`编辑 ${model.displayName}`} onClick={() => {
                  if (pending && !window.confirm("放弃当前尚未添加或保存的模型编辑？")) return;
                  setId(model.id); setDisplayName(model.displayName); setContextWindow(formatTokenCapacity(model.contextWindow));
                  setMaxOutputTokens(formatTokenCapacity(model.maxOutputTokens)); setImageInput(model.inputTypes.includes("image")); setReasoningEffort(model.reasoningEffort); setReasoningLevels(model.reasoningLevels.length ? model.reasoningLevels.map((row) => ({ ...row })) : defaultReasoningLevels()); setExpanded(true);
                  setEditingId(model.id); setError(null);
                }}>编辑</Button>
                <Button variant="ghost" aria-label={`移除 ${model.displayName}`} onClick={() => {
                  const next = models.filter((item) => item.id !== model.id);
                  onChange(next, defaultModel === model.id ? next[0]?.id ?? "" : defaultModel);
                  if (editingId === model.id) reset();
                }}>移除</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="settings-field__hint">尚未添加模型，请在下方填写后点击“添加模型”。</p>}
      <div className="ai-model-catalog__entry" role="group" aria-label={editingId ? "编辑模型" : "添加模型"}>
        <div className="ai-model-catalog__entry-header">
          <ComboBox ariaLabel="模型 ID" value={id} onChange={setId}
            options={discovered.filter((value) => !models.some((m) => m.id === value && m.id !== editingId)).map((value) => ({ value }))}
            placeholder="模型 ID" />
          <input aria-label="模型显示名称" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} placeholder="显示名称" />
          <button className="icon-button" type="button" aria-label={expanded ? "收起模型选项" : "展开模型选项"} aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}><Icon name={expanded ? "chevron-down" : "chevron-right"} height="16" width="16" /></button>
          <button className="icon-button" type="button" aria-label={editingId ? "取消编辑模型" : "清空当前模型"} onClick={reset}>
            <Icon name="trash" height="16" width="16" />
          </button>
        </div>
        {expanded ? (
          <div className="ai-model-catalog__entry-body">
            <label className="field">上下文窗口
              <input aria-label="模型上下文窗口" inputMode="decimal" value={contextWindow}
                onChange={(e) => setContextWindow(e.currentTarget.value)} placeholder="256K" />
            </label>
            <label className="field">最大输出 token 数
              <input aria-label="模型最大输出 token 数" inputMode="decimal" value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(e.currentTarget.value)} placeholder="32K" />
            </label>
            <div className="ai-model-catalog__input-types">
              <span>输入类型</span>
              <div className="ai-model-catalog__type-options">
                <label className="checkbox-field"><input type="checkbox" checked disabled />文本</label>
                <label className="checkbox-field"><input type="checkbox" checked={imageInput} onChange={(e) => setImageInput(e.currentTarget.checked)} />图片</label>
              </div>
            </div>
            <div className="ai-model-catalog__reasoning">
              <span>推理等级 <button type="button" className="ai-reasoning-levels__help" aria-label="推理等级说明"
                title="API 参数值会写入请求的推理强度字段（如 OpenAI 的 reasoning_effort），默认与档位名相同；如有不同，以模型提供商的 API 文档为准。off 用于关闭思考，不需要填写参数值；已有参数值会保留并发送。部分模型不支持关闭思考，请只配置模型支持的档位。">?</button></span>
              <input aria-label="启用推理等级" className="ai-model-catalog__switch" type="checkbox" role="switch" checked={reasoningEffort !== null}
                onChange={(e) => { if (e.currentTarget.checked) { setReasoningLevels(defaultReasoningLevels()); setReasoningEffort("medium"); } else setReasoningEffort(null); }} />
            </div>
            {reasoningEffort ? <AiReasoningLevels levels={reasoningLevels} onChange={(next) => {
              setReasoningLevels(next);
              if (!next.some((row) => row.level === reasoningEffort)) setReasoningEffort((next.find((row) => row.level !== "off") ?? next[0]).level);
            }} /> : null}
          </div>
        ) : null}
      </div>
      <div className="ai-model-catalog__entry-actions">
        <Button onClick={commit} disabled={!id.trim()}><Icon name="plus" width="16" height="16" />{editingId ? "保存模型" : "添加模型"}</Button>
      </div>
      {pending ? <span className="settings-field__hint">请先添加或取消当前模型，再保存服务配置。</span> : null}
      {error ? <div className="ai-provider__error" role="alert">{error}</div> : null}
    </section>
  );
}
